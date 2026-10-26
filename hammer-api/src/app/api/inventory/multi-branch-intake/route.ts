import { z } from "zod";
import { MultiBranchIntakeKind } from "@prisma/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";
import { parseListLimit } from "@/lib/api/list-limit";
import { prisma } from "@/lib/prisma";
import { createMultiBranchIntake, listMultiBranchIntakes, PossibleDuplicateIntakeError } from "@/modules/inventory/multi-branch-intake-service";

export const maxDuration = 60;

const lineSchema = z.object({
  productId: z.string().min(1),
  // Fase 1 (prompt-entrada-inventario.md) — PHYSICAL_COUNT permite 0 (un
  // conteo real que deja el producto en cero); la validación de "mayor a
  // 0" para ADD_STOCK/OPENING_BALANCE vive en el servicio, que sí conoce el
  // `kind` (acá, a nivel de línea suelta, no se puede distinguir).
  quantity: z.number().min(0),
  overrides: z.record(z.string(), z.number().min(0)).optional(),
  unitCost: z.number().min(0).optional(),
  salePrice: z.number().positive().optional(),
  // Commit 3 (prompt-entrada-reintento-precio.md) — mismo patrón que `overrides` de cantidad.
  salePriceOverrides: z.record(z.string(), z.number().positive()).optional(),
  unit: z.string().optional(),
  // "¿Costo del paquete?" revisado con "Revisé los avisos" — el costo es por unidad.
  confirmHighCost: z.boolean().optional(),
});

const createSchema = z.object({
  clientRequestId: z.string().min(1),
  kind: z.nativeEnum(MultiBranchIntakeKind),
  reason: z.string().trim().min(1),
  notes: z.string().optional().nullable(),
  // Fase 1 — "permitir 1 sucursal. Hoy exige 2: esa regla pasa a ser solo
  // de la pantalla de compras" (PurchaseOrderGroup, un módulo aparte).
  branchIds: z.array(z.string().min(1)).min(1),
  lines: z.array(lineSchema).min(1),
  // Commit 2 §4 — "Crear nueva igual" en el diálogo de posible duplicado.
  confirmDuplicate: z.boolean().optional(),
});

/** GET /api/inventory/multi-branch-intake — lista paginada. */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(request.url);
    const limit = parseListLimit(url.searchParams.get("limit"), { default: 25 });
    const cursor = url.searchParams.get("cursor") ?? undefined;

    return ok(await listMultiBranchIntakes({ limit, cursor }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

/**
 * POST /api/inventory/multi-branch-intake — Parte B.2: una carga de
 * inventario a varias sucursales. Permiso INVENTORY_MOVEMENT_POST en CADA
 * sucursal elegida — si falta en alguna, 403 con su nombre, nada se crea.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    const branches = await prisma.branch.findMany({ where: { id: { in: parsed.data.branchIds } }, select: { id: true, code: true, name: true } });
    const branchById = new Map(branches.map((b) => [b.id, b]));
    const missingBranches = parsed.data.branchIds.filter((id) => !branchById.has(id));
    if (missingBranches.length > 0) return fail("VALIDATION_ERROR", `Sucursal no encontrada: ${missingBranches.join(", ")}`, 400);

    const deniedBranches = parsed.data.branchIds.filter((id) => !canInBranch(session, id, CAPABILITIES.INVENTORY_MOVEMENT_POST));
    if (deniedBranches.length > 0) {
      const names = deniedBranches.map((id) => branchById.get(id)?.name ?? id).join(", ");
      return fail("FORBIDDEN", `No tienes permiso para registrar inventario en: ${names}.`, 403);
    }

    const result = await createMultiBranchIntake({ ...parsed.data, actorUserId: session!.userId });
    return created(result);
  } catch (error) {
    // Commit 2 §4 — no es un error real: el dueño elige "Corregir {code}"
    // o reenviar con confirmDuplicate:true ("Crear nueva igual"). 200, no 4xx.
    if (error instanceof PossibleDuplicateIntakeError) return ok({ possibleDuplicate: error.warning });
    return toHttpErrorResponse(error);
  }
}
