import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail, validationFail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { executeUnifiedCatalogInventoryImport, previewUnifiedCatalogInventoryImport } from "@/modules/catalog-inventory/import-service";
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

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    await assertCanImportInventory(session);

    const payload = await request.json();
    if (payload?.mode === "preview") {
      const parsed = previewSchema.safeParse(payload);
      if (!parsed.success) return validationFail(parsed.error.issues);
      return ok(await previewUnifiedCatalogInventoryImport({ ...parsed.data, actorUserId: session.userId }));
    }

    if (payload?.mode === "execute") {
      const parsed = executeSchema.safeParse(payload);
      if (!parsed.success) return validationFail(parsed.error.issues);
      return ok(await executeUnifiedCatalogInventoryImport({ ...parsed.data, actorUserId: session.userId }));
    }

    return fail("VALIDATION_ERROR", "mode debe ser preview o execute.", 400);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
