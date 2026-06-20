import { prisma } from "@/lib/prisma";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { ok, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { getBranchWorkflowConfig } from "@/modules/workflow/branch-workflow";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { canInBranch } from "@/modules/rbac/guards";
import { businessDateFromNow } from "@/modules/operations/service";
import { z } from "zod";

const querySchema = z.object({
  branchId: z.string().cuid(),
});

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ branchId: url.searchParams.get("branchId") });
    if (!parsed.success) return validationFail(parsed.error.flatten());

    const branchId = parsed.data.branchId;
    const todayBusinessDate = businessDateFromNow();

    const [workflow, cashBoxes, assignedSessions, todayDay, staleOpenDayCount, branchBlockingSession] = await Promise.all([
      getBranchWorkflowConfig(branchId),
      prisma.physicalCashBox.findMany({
        where: { branchId, isActive: true },
        include: {
          sessions: {
            where: { status: "OPEN" },
            include: {
              operators: {
                where: { isActive: true, revokedAt: null },
                include: { user: { select: { id: true, username: true, fullName: true } } },
              },
            },
            orderBy: { openedAt: "desc" },
            take: 1,
          },
        },
        orderBy: { code: "asc" },
      }),
      prisma.cashSession.findMany({
        where: {
          status: "OPEN",
          physicalCashBox: { branchId, isActive: true },
          operators: { some: { userId: session.userId, isActive: true, revokedAt: null } },
        },
        include: { physicalCashBox: true },
        orderBy: { openedAt: "desc" },
      }),
      prisma.operationalDay.findFirst({
        where: { branchId, businessDate: todayBusinessDate },
        select: { id: true, status: true },
      }),
      prisma.operationalDay.count({
        where: { branchId, status: "OPEN", businessDate: { lt: todayBusinessDate } },
      }),
      prisma.cashSession.findFirst({
        where: {
          status: { in: ["RECONCILING", "AUTO_CLOSED_PENDING_REVIEW"] },
          physicalCashBox: { branchId, isActive: true },
        },
        select: { id: true, status: true, physicalCashBoxId: true },
        orderBy: { openedAt: "asc" },
      }),
    ]);

    const rbacCanCollect = canInBranch(session, branchId, CAPABILITIES.POS_DIRECT_COLLECT)
      || (canInBranch(session, branchId, CAPABILITIES.POS_SEND_TO_CASHIER)
        && canInBranch(session, branchId, CAPABILITIES.PAYMENT_COLLECT_DIRECT));
    const canCollectHere = rbacCanCollect
      && workflow.paymentWorkflowMode !== "QUEUE_ONLY"
      && workflow.allowSellerDirectPayment;

    const hasOpenCashSession = assignedSessions.length > 0;
    const anyOpenSessionOnBranch = cashBoxes.some(box => box.sessions.length > 0);

    let cashSessionProblem: string | null = null;
    if (canCollectHere && !hasOpenCashSession) {
      if (staleOpenDayCount > 0) {
        cashSessionProblem = "STALE_OPERATIONAL_DAY_OPEN";
      } else if (!todayDay) {
        cashSessionProblem = "NO_OPERATIONAL_DAY";
      } else if (todayDay && todayDay.status !== "OPEN") {
        cashSessionProblem = "OPERATIONAL_DAY_CLOSED";
      } else if (branchBlockingSession?.status === "RECONCILING") {
        cashSessionProblem = "CASH_SESSION_RECONCILING";
      } else if (branchBlockingSession?.status === "AUTO_CLOSED_PENDING_REVIEW") {
        cashSessionProblem = "CASH_SESSION_AUTO_CLOSED_PENDING_REVIEW";
      } else if (anyOpenSessionOnBranch) {
        cashSessionProblem = "USER_NOT_ASSIGNED_TO_OPEN_SESSION";
      } else if (cashBoxes.length > 1) {
        cashSessionProblem = "CASH_BOX_REQUIRES_SELECTION";
      } else {
        cashSessionProblem = "NO_OPEN_CASH_SESSION";
      }
    }

    return ok({
      workflow,
      permissions: {
        canSendToCashier: canInBranch(session, branchId, CAPABILITIES.POS_SEND_TO_CASHIER),
        canCollectHere,
        canCollectByRole: canCollectHere,
        canUseCashSession: canInBranch(session, branchId, CAPABILITIES.CASH_SESSION_USE),
      },
      cashBoxes,
      assignedSessions,
      hasOpenCashSession,
      activeCashSessionId: assignedSessions[0]?.id ?? null,
      cashSessionProblem,
      messages: {
        noCashBoxes: cashBoxes.length === 0 ? "No hay cajas fisicas configuradas para esta sucursal." : null,
        noAssignedSession: !hasOpenCashSession ? "No tienes una sesion de caja abierta asignada." : null,
        cashSessionProblem: cashSessionProblem === "NO_OPERATIONAL_DAY"
          ? "No hay dia operativo abierto para esta sucursal."
          : cashSessionProblem === "CASH_SESSION_AUTO_CLOSED_PENDING_REVIEW"
            ? "Caja cerrada automaticamente y pendiente de revision."
            : cashSessionProblem === "CASH_SESSION_RECONCILING"
              ? "Caja en conciliacion. Debe completarse antes de continuar."
              : cashSessionProblem === "CASH_BOX_REQUIRES_SELECTION"
                ? "Selecciona una caja fisica para continuar."
                : null,
        permittedButNotAssigned: canCollectHere && !hasOpenCashSession
          ? "Tienes permiso para cobrar pero no estas asignado a ninguna sesion de caja abierta. Pide a un cajero que te asigne."
          : null,
      },
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
