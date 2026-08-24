import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { isMaster } from "@/modules/rbac/guards";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { prisma } from "@/lib/prisma";
import { postponeDepositSchema } from "@/modules/treasury/validators";
import { postponeCashDeposit } from "@/modules/treasury/cash-monitor";

/**
 * "Dejar en caja hasta mañana" con la sesión ABIERTA — mismo permiso que
 * operar la sesión (CASH_SESSION_OPERATE), mismo patrón que send-deposit
 * (§4 del módulo Destino del efectivo). No mueve dinero: registra la
 * decisión (postponeCashDeposit, treasury/cash-monitor.ts).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: cashSessionId } = await params;
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = postponeDepositSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());
    if (parsed.data.cashSessionId !== cashSessionId) return fail("VALIDATION_ERROR", "cashSessionId no coincide con la URL.", 400);

    const cashSession = await prisma.cashSession.findUniqueOrThrow({
      where: { id: cashSessionId },
      include: { physicalCashBox: true },
    });
    const branchId = cashSession.physicalCashBox.branchId;

    if (!canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_OPERATE)) return fail("FORBIDDEN", "Forbidden", 403);
    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.CASH_SESSION_OPERATE)) return fail("FORBIDDEN", "Forbidden", 403);

    const result = await postponeCashDeposit({
      cashSessionId,
      branchId,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
      actorUserId: session.userId,
    });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
