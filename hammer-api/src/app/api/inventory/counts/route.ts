import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";
import { createStockCount, listStockCountsForViewer } from "@/modules/inventory/stock-count-service";

export const maxDuration = 30;

const createSchema = z.object({
  branchId: z.string().min(1),
  title: z.string().trim().min(1),
  categoryIds: z.array(z.string().min(1)).optional(),
  blind: z.boolean().optional(),
  assignedUserIds: z.array(z.string().min(1)).min(1),
});

function isPrivilegedGlobally(session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>): boolean {
  return session.globalRoles.some((role) => role === "MASTER" || role === "OWNER" || role === "SYSTEM_ADMIN");
}

/** GET /api/inventory/counts — Master ve todas (de la sucursal, si se filtra); el contador ve solo las OPEN donde está asignado. */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId") ?? undefined;
    const isPrivileged = isPrivilegedGlobally(session);

    return ok(await listStockCountsForViewer({ branchId, viewerUserId: session.userId, isPrivileged }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

/** POST /api/inventory/counts — crea la sesión de conteo (Master/Owner/SystemAdmin, prompt-conteo-delegado.md Commit 1). */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    if (!canInBranch(session, parsed.data.branchId, CAPABILITIES.INVENTORY_COUNT_APPROVE)) {
      return fail("FORBIDDEN", "No tenés permiso para crear conteos en esta sucursal.", 403);
    }

    const stockCount = await createStockCount({ ...parsed.data, actorUserId: session!.userId });
    return created(stockCount);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
