import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { isMaster } from "@/modules/rbac/guards";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { prisma } from "@/lib/prisma";
import { sendCashOutSchema } from "@/modules/treasury/validators";
import { sendCashOutToCustody } from "@/modules/treasury/cash-monitor";

/**
 * "Enviar depósito" / "Entregar en persona" con la sesión ABIERTA
 * (prompt-indicador-efectivo-inteligente.md §4) — mismo permiso que operar
 * la sesión (CASH_SESSION_OPERATE), igual que la declaración de destino al
 * cierre: es el mismo tipo de acto, solo que no espera al cierre.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: cashSessionId } = await params;
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = sendCashOutSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());
    if (parsed.data.cashSessionId !== cashSessionId) return fail("VALIDATION_ERROR", "cashSessionId no coincide con la URL.", 400);

    const cashSession = await prisma.cashSession.findUniqueOrThrow({
      where: { id: cashSessionId },
      include: { physicalCashBox: true },
    });
    const branchId = cashSession.physicalCashBox.branchId;

    if (!canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_OPERATE)) return fail("FORBIDDEN", "Forbidden", 403);
    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.CASH_SESSION_OPERATE)) return fail("FORBIDDEN", "Forbidden", 403);

    const result = await sendCashOutToCustody({
      cashSessionId,
      branchId,
      amount: parsed.data.amount,
      carrierUserId: parsed.data.carrierUserId,
      reason: parsed.data.reason,
      bankAccountId: parsed.data.bankAccountId,
      recipientUserId: parsed.data.recipientUserId,
      actorUserId: session.userId,
    });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
