import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";
import { parseListLimit } from "@/lib/api/list-limit";
import { prisma } from "@/lib/prisma";
import { createTransferGroup, listTransferGroups } from "@/modules/transfers/group-service";

const lineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive(),
  overrides: z.record(z.string(), z.number().min(0)).optional(),
});

const createSchema = z.object({
  clientRequestId: z.string().min(1),
  fromBranchId: z.string().min(1),
  toBranchIds: z.array(z.string().min(1)).min(2),
  notes: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1),
});

/** GET /api/transfers/groups — lista paginada. */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(request.url);
    const limit = parseListLimit(url.searchParams.get("limit"), { default: 25 });
    const cursor = url.searchParams.get("cursor") ?? undefined;

    return ok(await listTransferGroups({ limit, cursor }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

/**
 * POST /api/transfers/groups — Parte B.3: un origen, varios destinos, la
 * misma matriz. Permiso TRANSFERS_CREATE en el origen Y en cada destino —
 * si falta en alguna, 403 con su nombre, nada se crea. La validación de
 * stock (suma de todos los destinos contra lo bloqueado del origen) vive
 * en el servicio, dentro de la misma transacción.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    const allBranchIds = [parsed.data.fromBranchId, ...parsed.data.toBranchIds];
    const branches = await prisma.branch.findMany({ where: { id: { in: allBranchIds } }, select: { id: true, code: true, name: true } });
    const branchById = new Map(branches.map((b) => [b.id, b]));
    const missingBranches = allBranchIds.filter((id) => !branchById.has(id));
    if (missingBranches.length > 0) return fail("VALIDATION_ERROR", `Sucursal no encontrada: ${missingBranches.join(", ")}`, 400);

    const deniedBranches = allBranchIds.filter((id) => !canInBranch(session, id, CAPABILITIES.TRANSFERS_CREATE));
    if (deniedBranches.length > 0) {
      const names = deniedBranches.map((id) => branchById.get(id)?.name ?? id).join(", ");
      return fail("FORBIDDEN", `No tienes permiso para trasladar en: ${names}.`, 403);
    }

    const result = await createTransferGroup({ ...parsed.data, actorUserId: session!.userId });
    return created(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
