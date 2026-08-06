import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { prisma } from "@/lib/prisma";
import { businessDateFromNow } from "@/modules/operations/service";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";

/**
 * Diagnostic endpoint — MASTER only, read-only.
 *
 * Returns a snapshot that surfaces operational inconsistencies:
 *  1. Active branches with no active physical cash box.
 *  2. OPEN operational days per branch (including stale ones).
 *  3. Cash sessions in problematic states (OPEN / RECONCILING / AUTO_CLOSED_PENDING_REVIEW).
 *  4. OPEN sessions whose activeSessionKey does not match OPEN:<physicalCashBoxId>.
 *  5. Physical cash boxes that have more than one OPEN session simultaneously.
 *
 * No data is mutated. Safe to run in production at any time.
 */
export async function GET(_request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const todayBusinessDate = businessDateFromNow();

    const [
      branches,
      openOperationalDays,
      problematicSessions,
      openSessionsForKeyCheck,
      duplicateOpenGroups,
    ] = await Promise.all([
      // 1. Active branches + their cash boxes (all, to show inactive ones too)
      prisma.branch.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          physicalCashBoxes: {
            select: { id: true, code: true, isActive: true },
          },
        },
        orderBy: { code: "asc" },
      }),

      // 2. All OPEN operational days
      prisma.operationalDay.findMany({
        where: { status: "OPEN" },
        select: {
          id: true,
          branchId: true,
          businessDate: true,
          openedAt: true,
          openCashSessionsCount: true,
          autoClosedPendingReviewCount: true,
          branch: { select: { code: true, name: true } },
        },
        orderBy: [{ branchId: "asc" }, { businessDate: "desc" }],
      }),

      // 3. Sessions in states that require attention
      prisma.cashSession.findMany({
        where: { status: { in: ["OPEN", "RECONCILING", "AUTO_CLOSED_PENDING_REVIEW"] } },
        select: {
          id: true,
          status: true,
          activeSessionKey: true,
          physicalCashBoxId: true,
          operationalDayId: true,
          openedAt: true,
          autoClosedAt: true,
          requiresReview: true,
          physicalCashBox: {
            select: {
              code: true,
              isActive: true,
              branch: { select: { code: true } },
            },
          },
          operationalDay: { select: { businessDate: true, status: true } },
        },
        orderBy: [{ physicalCashBox: { branchId: "asc" } }, { openedAt: "desc" }],
      }),

      // 4. OPEN sessions — used to detect broken activeSessionKey
      prisma.cashSession.findMany({
        where: { status: "OPEN", activeSessionKey: { not: null } },
        select: {
          id: true,
          physicalCashBoxId: true,
          activeSessionKey: true,
          physicalCashBox: {
            select: { code: true, branch: { select: { code: true } } },
          },
        },
      }),

      // 5. Boxes with more than one OPEN session (grouped)
      prisma.cashSession.groupBy({
        by: ["physicalCashBoxId"],
        where: { status: "OPEN" },
        _count: { _all: true },
        having: { physicalCashBoxId: { _count: { gt: 1 } } },
      }),
    ]);

    // --- 1. Branches without active cash box ---
    const branchesWithoutActiveBox = branches
      .filter((b) => !b.physicalCashBoxes.some((box) => box.isActive))
      .map((b) => ({
        branchId: b.id,
        branchCode: b.code,
        branchName: b.name,
        totalBoxes: b.physicalCashBoxes.length,
        boxes: b.physicalCashBoxes.map((box) => ({ code: box.code, isActive: box.isActive })),
      }));

    // --- 2. Open operational days with stale detection ---
    const openDayRows = openOperationalDays.map((d) => ({
      id: d.id,
      branchCode: d.branch.code,
      branchName: d.branch.name,
      businessDate: d.businessDate.toISOString(),
      openedAt: d.openedAt.toISOString(),
      openCashSessionsCount: d.openCashSessionsCount,
      autoClosedPendingReviewCount: d.autoClosedPendingReviewCount,
      isStale: d.businessDate.getTime() !== todayBusinessDate.getTime(),
    }));

    // --- 4. Broken activeSessionKey ---
    const brokenActiveSessionKeys = openSessionsForKeyCheck
      .filter((s) => s.activeSessionKey !== `OPEN:${s.physicalCashBoxId}`)
      .map((s) => ({
        sessionId: s.id,
        branchCode: s.physicalCashBox.branch.code,
        boxCode: s.physicalCashBox.code,
        physicalCashBoxId: s.physicalCashBoxId,
        activeSessionKey: s.activeSessionKey,
        expected: `OPEN:${s.physicalCashBoxId}`,
      }));

    // --- 5. Boxes with multiple OPEN sessions ---
    const dupBoxIds = duplicateOpenGroups.map((g) => g.physicalCashBoxId);
    const dupBoxDetails = dupBoxIds.length > 0
      ? await prisma.physicalCashBox.findMany({
          where: { id: { in: dupBoxIds } },
          select: { id: true, code: true, branch: { select: { code: true } } },
        })
      : [];

    const boxesWithMultipleOpenSessions = duplicateOpenGroups.map((g) => {
      const box = dupBoxDetails.find((b) => b.id === g.physicalCashBoxId);
      return {
        physicalCashBoxId: g.physicalCashBoxId,
        boxCode: box?.code ?? "?",
        branchCode: box?.branch.code ?? "?",
        openCount: g._count._all,
      };
    });

    return ok({
      generatedAt: new Date().toISOString(),
      todayBusinessDate: todayBusinessDate.toISOString(),
      branchesWithoutActiveBox,
      openOperationalDays: openDayRows,
      staleOpenDaysCount: openDayRows.filter((d) => d.isStale).length,
      problematicSessions: problematicSessions.map((s) => ({
        id: s.id,
        status: s.status,
        branchCode: s.physicalCashBox.branch.code,
        boxCode: s.physicalCashBox.code,
        boxIsActive: s.physicalCashBox.isActive,
        activeSessionKey: s.activeSessionKey,
        operationalDayBusinessDate: s.operationalDay?.businessDate?.toISOString() ?? null,
        operationalDayStatus: s.operationalDay?.status ?? null,
        openedAt: s.openedAt.toISOString(),
        autoClosedAt: s.autoClosedAt?.toISOString() ?? null,
        requiresReview: s.requiresReview,
      })),
      brokenActiveSessionKeys,
      boxesWithMultipleOpenSessions,
    });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
