import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { prisma } from "@/lib/prisma";
import { businessDateFromNow } from "@/modules/operations/service";
import { fail, ok } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";

export async function GET(_request: Request, { params }: { params: Promise<{ branchId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    if (!isMaster(session)) {
      return fail("FORBIDDEN", "Solo administradores Master pueden acceder a este diagnóstico.", 403);
    }

    const { branchId } = await params;

    const todayBusinessDate = businessDateFromNow();

    const [branch, cashBoxes, todayDay, staleOpenDays] = await Promise.all([
      prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true } }),
      prisma.physicalCashBox.findMany({
        where: { branchId },
        include: {
          sessions: {
            where: { status: { in: ["OPEN", "RECONCILING", "AUTO_CLOSED_PENDING_REVIEW"] } },
            select: { id: true, status: true, openedAt: true, activeSessionKey: true },
            orderBy: { openedAt: "desc" },
            take: 1,
          },
        },
        orderBy: { code: "asc" },
      }),
      prisma.operationalDay.findFirst({
        where: { branchId, businessDate: todayBusinessDate },
        select: { id: true, status: true, businessDate: true, closedAt: true, approvedAt: true },
      }),
      prisma.operationalDay.findMany({
        where: { branchId, status: "OPEN", businessDate: { lt: todayBusinessDate } },
        select: { id: true, status: true, businessDate: true },
        orderBy: { businessDate: "asc" },
      }),
    ]);

    if (!branch) {
      return fail("NOT_FOUND", "Sucursal no encontrada.", 404);
    }

    const blockers: string[] = [];

    if (staleOpenDays.length > 0) {
      blockers.push(`STALE_OPERATIONAL_DAY_OPEN: ${staleOpenDays.length} día(s) anterior(es) sin cerrar.`);
    }

    if (todayDay && todayDay.status !== "OPEN") {
      blockers.push(`OPERATIONAL_DAY_CLOSED: El día operativo de hoy tiene estado ${todayDay.status}.`);
    }

    const activeBoxes = cashBoxes.filter(box => box.isActive);
    if (activeBoxes.length === 0) {
      blockers.push("NO_ACTIVE_CASH_BOX_FOR_BRANCH: No hay cajas físicas activas en esta sucursal.");
    }

    const boxesWithLiveSessions = cashBoxes.filter(box => box.sessions.some(s => s.status === "OPEN" || s.status === "RECONCILING" || s.status === "AUTO_CLOSED_PENDING_REVIEW"));
    for (const box of boxesWithLiveSessions) {
      const liveSession = box.sessions[0];
      if (liveSession?.status === "RECONCILING") {
        blockers.push(`CASH_SESSION_RECONCILING: Caja ${box.code} tiene sesión en conciliación (${liveSession.id}).`);
      } else if (liveSession?.status === "AUTO_CLOSED_PENDING_REVIEW") {
        blockers.push(`CASH_SESSION_AUTO_CLOSED_PENDING_REVIEW: Caja ${box.code} tiene cierre automático pendiente de revisión (${liveSession.id}).`);
      }
    }

    const canOpenCashSession = blockers.length === 0;

    return ok({
      branchId,
      branchName: branch.name,
      canOpenCashSession,
      blockers,
      cashBoxes: cashBoxes.map(box => ({
        id: box.id,
        code: box.code,
        description: box.description,
        isActive: box.isActive,
        liveSession: box.sessions[0]
          ? { id: box.sessions[0].id, status: box.sessions[0].status, openedAt: box.sessions[0].openedAt }
          : null,
      })),
      todayOperationalDay: todayDay
        ? { id: todayDay.id, status: todayDay.status, businessDate: todayDay.businessDate, closedAt: todayDay.closedAt, approvedAt: todayDay.approvedAt }
        : null,
      staleOperationalDays: staleOpenDays.map(d => ({ id: d.id, status: d.status, businessDate: d.businessDate })),
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
