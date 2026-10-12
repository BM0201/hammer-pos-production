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
import { createMultiBranchIntake, listMultiBranchIntakes } from "@/modules/inventory/multi-branch-intake-service";

export const maxDuration = 60;

const lineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive(),
  overrides: z.record(z.string(), z.number().min(0)).optional(),
  unitCost: z.number().min(0).optional(),
});

const createSchema = z.object({
  clientRequestId: z.string().min(1),
  kind: z.nativeEnum(MultiBranchIntakeKind),
  reason: z.string().trim().min(1),
  notes: z.string().optional().nullable(),
  branchIds: z.array(z.string().min(1)).min(2),
  lines: z.array(lineSchema).min(1),
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
    return toHttpErrorResponse(error);
  }
}
