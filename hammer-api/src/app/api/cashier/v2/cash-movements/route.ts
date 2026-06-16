import { CashMovementType } from "@prisma/client";
import { z } from "zod";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { created, ok, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";
import { createCashMovement, listCashMovements } from "@/modules/cash-session/service";
import { prisma } from "@/lib/prisma";

const movementSchema = z.object({
  cashSessionId: z.string().cuid(),
  type: z.nativeEnum(CashMovementType),
  amount: z.coerce.number().positive(),
  reason: z.string().min(2).max(200),
  notes: z.string().max(500).optional().nullable(),
});

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(request.url);
    const cashSessionId = url.searchParams.get("cashSessionId");
    if (!cashSessionId) return validationFail({ cashSessionId: ["Required"] });

    const cashSession = await prisma.cashSession.findUniqueOrThrow({
      where: { id: cashSessionId },
      include: { physicalCashBox: true },
    });
    requireBranchCapability(session, cashSession.physicalCashBox.branchId, CAPABILITIES.CASH_MOVEMENT_VIEW);

    const movements = await listCashMovements(cashSessionId);
    return ok(movements);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = movementSchema.safeParse(await request.json());
    if (!parsed.success) return validationFail(parsed.error.flatten());

    const cashSession = await prisma.cashSession.findUniqueOrThrow({
      where: { id: parsed.data.cashSessionId },
      include: { physicalCashBox: true },
    });
    requireBranchCapability(session, cashSession.physicalCashBox.branchId, CAPABILITIES.CASH_MOVEMENT_CREATE);

    const movement = await createCashMovement({
      cashSessionId: parsed.data.cashSessionId,
      type: parsed.data.type,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
      notes: parsed.data.notes,
      actorUserId: session.userId,
    });
    return created(movement);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
