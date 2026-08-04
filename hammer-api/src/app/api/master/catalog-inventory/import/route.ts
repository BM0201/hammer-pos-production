import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster, hasBranchAccess } from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail, validationFail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { analyzeUnifiedImport, createMissingCategoriesForImport, executeUnifiedCatalogInventoryImport, previewUnifiedCatalogInventoryImport } from "@/modules/catalog-inventory/import-service";
import type { SessionPayload } from "@/types/auth";

export const maxDuration = 300;

const importTypeSchema = z.enum([
  "CATALOG_ONLY",
  "CATALOG_WITH_INITIAL_STOCK",
  "CATALOG_WITH_INITIAL_INVENTORY",
  "INVENTORY_ADD_STOCK",
  "INVENTORY_ONLY",
  "INVENTORY_SET_STOCK",
  "GLOBAL_PRICES_COSTS",
  "BRANCH_PRICES_COSTS",
  "PRICES_COSTS_ONLY",
  "PHYSICAL_COUNT_ADJUSTMENT",
  "PHYSICAL_COUNT",
]);
const destinationModeSchema = z.enum(["SINGLE", "MULTI", "ALL", "FILE"]);

const previewSchema = z.object({
  mode: z.literal("preview"),
  importType: importTypeSchema,
  fileContent: z.string().min(1).optional(),
  fileBase64: z.string().min(1).optional(),
  destinationMode: destinationModeSchema,
  branchIds: z.array(z.string().cuid()).optional(),
  defaultBranchId: z.string().cuid().optional(),
  createMissingProducts: z.boolean().default(false),
  defaultCategoryId: z.string().cuid().optional(),
  defaultUnit: z.string().min(1).max(32).optional(),
  defaultStandardSalePrice: z.number().positive().optional(),
}).refine((payload) => Boolean(payload.fileContent || payload.fileBase64), {
  message: "Debes enviar fileContent o fileBase64.",
  path: ["fileContent"],
});

const analyzeSchema = z.object({
  mode: z.literal("analyze"),
  importType: importTypeSchema,
  fileContent: z.string().min(1).optional(),
  fileBase64: z.string().min(1).optional(),
  destinationMode: destinationModeSchema,
  defaultCategoryId: z.string().cuid().optional(),
}).refine((p) => Boolean(p.fileContent || p.fileBase64), {
  message: "Debes enviar fileContent o fileBase64.",
  path: ["fileContent"],
});

const createCategoriesSchema = z.object({
  mode: z.literal("create-categories"),
  categoryCodes: z.array(z.string().min(1)).min(1),
});

const executeSchema = z.object({
  mode: z.literal("execute"),
  batchId: z.string().cuid(),
});

async function assertCanImportInventory(session: SessionPayload) {
  if (isMaster(session)) return;
  const permission = await prisma.userPermission.findUnique({
    where: { userId_permission: { userId: session.userId, permission: "inventory.import" } },
    select: { granted: true },
  });
  if (!permission?.granted) throw new Error("FORBIDDEN_INVENTORY_IMPORT");
}

// Auditoría 2026-08-03: "inventory.import" es un permiso GLOBAL (sin
// branchId) — una vez otorgado a un no-Master (para que importe stock de
// SU sucursal), el endpoint no aplicaba ningún scope: el payload acepta
// destinationMode ALL/MULTI con branchIds arbitrarios, permitiendo
// sobrescribir costos/precios/stock de TODAS las sucursales, no solo la
// propia. "ALL" queda reservado a Master; SINGLE/MULTI exigen pertenencia
// a cada sucursal de destino.
function assertImportDestinationAccess(
  session: SessionPayload,
  input: { destinationMode: string; branchIds?: string[]; defaultBranchId?: string },
) {
  if (input.destinationMode === "ALL") {
    if (!isMaster(session)) {
      throw new Error("FORBIDDEN: importar a todas las sucursales requiere rol Master");
    }
    return;
  }
  const targetBranchIds = input.destinationMode === "MULTI"
    ? (input.branchIds ?? [])
    : input.defaultBranchId
      ? [input.defaultBranchId]
      : [];
  for (const branchId of targetBranchIds) {
    if (!hasBranchAccess(session, branchId)) {
      throw new Error("FORBIDDEN: no tienes acceso a una de las sucursales de destino de esta importación");
    }
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    await assertCanImportInventory(session);

    const payload = await request.json();

    if (payload?.mode === "analyze") {
      const parsed = analyzeSchema.safeParse(payload);
      if (!parsed.success) return validationFail(parsed.error.issues);
      return ok(await analyzeUnifiedImport(parsed.data));
    }

    if (payload?.mode === "create-categories") {
      const parsed = createCategoriesSchema.safeParse(payload);
      if (!parsed.success) return validationFail(parsed.error.issues);
      return ok(await createMissingCategoriesForImport(parsed.data.categoryCodes, session.userId));
    }

    if (payload?.mode === "preview") {
      const parsed = previewSchema.safeParse(payload);
      if (!parsed.success) return validationFail(parsed.error.issues);
      assertImportDestinationAccess(session, parsed.data);
      return ok(await previewUnifiedCatalogInventoryImport({ ...parsed.data, actorUserId: session.userId }));
    }

    if (payload?.mode === "execute") {
      const parsed = executeSchema.safeParse(payload);
      if (!parsed.success) return validationFail(parsed.error.issues);

      // El payload de execute solo trae el batchId — el scope real
      // (destinationMode/branchIds) quedó fijado en preview. Se revalida
      // acá por si el batch fue creado por otro usuario o los permisos de
      // sucursal cambiaron entre preview y execute.
      const batch = await prisma.inventoryImportBatch.findUnique({
        where: { id: parsed.data.batchId },
        select: { destinationMode: true, defaultBranchId: true, createdByUserId: true },
      });
      if (!batch) return fail("NOT_FOUND", "Lote de importación no encontrado.", 404);

      if (batch.destinationMode === "ALL" || batch.destinationMode === "MULTI") {
        if (!isMaster(session) && batch.createdByUserId !== session.userId) {
          return fail("FORBIDDEN", "No puedes ejecutar un lote de importación multi-sucursal creado por otro usuario.", 403);
        }
      } else if (batch.defaultBranchId && !hasBranchAccess(session, batch.defaultBranchId)) {
        return fail("FORBIDDEN", "No tienes acceso a la sucursal de destino de este lote.", 403);
      }

      return ok(await executeUnifiedCatalogInventoryImport({ ...parsed.data, actorUserId: session.userId }));
    }

    return fail("VALIDATION_ERROR", "mode debe ser analyze, preview, create-categories o execute.", 400);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
