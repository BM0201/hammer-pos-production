import { CashSessionOperatorRole } from "@prisma/client";
import { z } from "zod";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { prisma } from "@/lib/prisma";
import { created, ok, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";
import { assignCashSessionOperator, revokeCashSessionOperator } from "@/modules/cash-session/service";

const operatorSchema = z.object({
  cashSessionId: z.string().cuid(),
  userId: z.string().cuid(),
  operatorRole: z.nativeEnum(CashSessionOperatorRole).optional(),
  action: z.enum(["ASSIGN", "REVOKE"]).default("ASSIGN"),
});

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = operatorSchema.safeParse(await request.json());
    if (!parsed.success) return validationFail(parsed.error.flatten());

    const cashSession = await prisma.cashSession.findUniqueOrThrow({
      where: { id: parsed.data.cashSessionId },
      include: { physicalCashBox: true },
    });
    requireBranchCapability(session, cashSession.physicalCashBox.branchId, CAPABILITIES.CASH_SESSION_ASSIGN_OPERATOR);

    if (parsed.data.action === "REVOKE") {
      const result = await revokeCashSessionOperator({
        cashSessionId: parsed.data.cashSessionId,
        userId: parsed.data.userId,
        actorUserId: session.userId,
      });
      return ok(result);
    }

    const result = await assignCashSessionOperator({
      cashSessionId: parsed.data.cashSessionId,
      userId: parsed.data.userId,
      operatorRole: parsed.data.operatorRole ?? CashSessionOperatorRole.CASHIER_OPERATOR,
      assignedByUserId: session.userId,
    });
    return created(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
