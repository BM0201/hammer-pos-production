import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok, fail } from "@/lib/api/response";
import { requireCsrf } from "@/modules/security/csrf";
import { reviewAutoClosedCashSessionSchema } from "@/modules/cash-session/validators";
import { reviewAutoClosedCashSession, logCashSessionDenied } from "@/modules/cash-session/service";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let targetBranchId: string | undefined;

  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);
    await requireCsrf(request, session);

    const payload = await request.json();
    const parsed = reviewAutoClosedCashSessionSchema.safeParse({
      ...payload,
      cashSessionId: id,
    });
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    const cashSession = await prisma.cashSession.findUnique({
      where: { id },
      include: { physicalCashBox: { select: { branchId: true } } },
    });
    targetBranchId = cashSession?.physicalCashBox.branchId;

    const data = await reviewAutoClosedCashSession({
      cashSessionId: parsed.data.cashSessionId,
      countedCashAmount: parsed.data.countedCashAmount,
      confirmOk: parsed.data.confirmOk,
      note: parsed.data.note,
      actorUserId: session!.userId,
    });

    return ok(data);
  } catch (error) {
    if (error instanceof Error && error.message === "CASH_SESSION_NOT_PENDING_AUTO_REVIEW") {
      const session = await getCurrentSession().catch(() => null);
      await logCashSessionDenied({
        actorUserId: session?.userId,
        branchId: targetBranchId,
        entityId: id,
        reason: error.message,
      });
      return fail("CONFLICT", error.message, 409);
    }
    return toApiErrorResponse(error);
  }
}
