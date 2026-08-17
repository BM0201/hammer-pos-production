import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, created, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { isMaster } from "@/modules/rbac/guards";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { prisma } from "@/lib/prisma";
import { declareCashDestinationSchema } from "@/modules/treasury/validators";
import { declareCashDestination } from "@/modules/treasury/service";

/**
 * Declaración de destino del efectivo al cerrar caja
 * (correccion-destino-y-pantalla-cobro.md §1) — mismo permiso que cerrar la
 * sesión (CASH_SESSION_OPERATE), porque es el mismo acto: quien cierra la
 * caja declara qué pasó con el efectivo contado.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: cashSessionId } = await params;
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = declareCashDestinationSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());
    if (parsed.data.cashSessionId !== cashSessionId) return fail("VALIDATION_ERROR", "cashSessionId no coincide con la URL.", 400);

    const cashSession = await prisma.cashSession.findUniqueOrThrow({
      where: { id: cashSessionId },
      include: { physicalCashBox: true },
    });
    const branchId = cashSession.physicalCashBox.branchId;

    if (!canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_OPERATE)) return fail("FORBIDDEN", "Forbidden", 403);
    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.CASH_SESSION_OPERATE)) return fail("FORBIDDEN", "Forbidden", 403);

    const declaration = await declareCashDestination({
      ...parsed.data,
      branchId,
      declaredByUserId: session.userId,
    });
    return created(declaration);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
