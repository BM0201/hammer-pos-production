import { prisma } from "@/lib/prisma";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { ok, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { getBranchWorkflowConfig } from "@/modules/workflow/branch-workflow";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { canInBranch } from "@/modules/rbac/guards";
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
    const [workflow, cashBoxes, assignedSessions] = await Promise.all([
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
    ]);

    const canCollectHere = canInBranch(session, branchId, CAPABILITIES.POS_DIRECT_COLLECT)
      || (canInBranch(session, branchId, CAPABILITIES.POS_SEND_TO_CASHIER)
        && canInBranch(session, branchId, CAPABILITIES.PAYMENT_COLLECT_DIRECT));

    return ok({
      workflow,
      permissions: {
        canSendToCashier: canInBranch(session, branchId, CAPABILITIES.POS_SEND_TO_CASHIER),
        canCollectHere,
        canUseCashSession: canInBranch(session, branchId, CAPABILITIES.CASH_SESSION_USE),
      },
      cashBoxes,
      assignedSessions,
      messages: {
        noCashBoxes: cashBoxes.length === 0 ? "No hay cajas fisicas configuradas para esta sucursal." : null,
        noAssignedSession: assignedSessions.length === 0 ? "No tienes una sesion de caja abierta asignada." : null,
        permittedButNotAssigned: canCollectHere && assignedSessions.length === 0
          ? "Tienes permiso para cobrar pero no estas asignado a ninguna sesion de caja abierta. Pide a un cajero que te asigne."
          : null,
      },
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
