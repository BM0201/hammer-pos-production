/**
 * repair-discrepancy-approvals.ts
 *
 * Repairs CASH_SESSION_DISCREPANCY ApprovalRequests that are stuck in
 * REQUESTED/UNDER_REVIEW and whose CashSession is still in RECONCILING.
 *
 * Before this fix, closing a session with |difference| > C$5 created an
 * ApprovalRequest and left the session in RECONCILING waiting for Master.
 * After the fix, manual closes always finish immediately. This script
 * retroactively closes any sessions that got stuck under the old behavior.
 *
 * Usage:
 *   # Dry-run (default — no DB writes):
 *   DRY_RUN=true npx tsx src/scripts/repair-discrepancy-approvals.ts
 *
 *   # Execute for real:
 *   DRY_RUN=false REPAIR_ACTOR_USER_ID=<master-user-id> npx tsx src/scripts/repair-discrepancy-approvals.ts
 */

import { ApprovalStatus, ApprovalType, CashSessionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { refreshOperationalDaySummaryTx } from "@/modules/operations/service";

const DRY_RUN = process.env.DRY_RUN !== "false";
const ACTOR_USER_ID = process.env.REPAIR_ACTOR_USER_ID ?? "system-repair";

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

async function main() {
  console.log("=".repeat(60));
  console.log(`repair-discrepancy-approvals  [${DRY_RUN ? "DRY_RUN" : "EXECUTE"}]`);
  console.log("=".repeat(60));

  const stuckApprovals = await prisma.approvalRequest.findMany({
    where: {
      type: ApprovalType.CASH_SESSION_DISCREPANCY,
      status: { in: [ApprovalStatus.REQUESTED, ApprovalStatus.UNDER_REVIEW] },
    },
    include: {
      branch: { select: { id: true, code: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\nFound ${stuckApprovals.length} stuck CASH_SESSION_DISCREPANCY approval(s).\n`);

  let repaired = 0;
  let skipped = 0;

  for (const approval of stuckApprovals) {
    const cashSessionId = approval.referenceId;
    const payload = (approval.payloadJson ?? {}) as {
      countedCash?: number;
      expectedCash?: number;
      difference?: number;
    };

    console.log(`Approval ${approval.id}  branch=${approval.branch?.code ?? approval.branchId}  session=${cashSessionId}`);

    const cashSession = await prisma.cashSession.findUnique({
      where: { id: cashSessionId },
      include: { physicalCashBox: { select: { branchId: true } } },
    });

    if (!cashSession) {
      console.log("  SKIP — CashSession not found");
      skipped++;
      continue;
    }

    if (cashSession.status !== CashSessionStatus.RECONCILING) {
      console.log(`  SKIP — CashSession status is ${cashSession.status}, not RECONCILING`);
      skipped++;
      continue;
    }

    const countedCash = payload.countedCash ?? Number(cashSession.closingAmount ?? cashSession.openingAmount);
    const expectedCash = payload.expectedCash ?? Number(cashSession.expectedCashAmount ?? cashSession.openingAmount);
    const difference = countedCash - expectedCash;

    console.log(`  countedCash=${countedCash}  expectedCash=${expectedCash}  difference=${difference}`);

    if (DRY_RUN) {
      console.log("  [DRY_RUN] Would close session and mark approval as EXECUTED");
      repaired++;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.cashSession.update({
          where: { id: cashSessionId },
          data: {
            status: CashSessionStatus.CLOSED,
            closedAt: new Date(),
            closingAmount: toDecimal(countedCash),
            countedCashAmount: toDecimal(countedCash),
            expectedCashAmount: toDecimal(expectedCash),
            differenceAmount: toDecimal(difference),
            requiresReview: false,
            closedByUserId: ACTOR_USER_ID,
          },
        });

        // Mark the approval as resolved so it disappears from the queue
        await tx.approvalRequest.update({
          where: { id: approval.id },
          data: { status: ApprovalStatus.EXECUTED },
        });

        if (cashSession.operationalDayId) {
          await refreshOperationalDaySummaryTx(tx, cashSession.operationalDayId);
        }

        await tx.auditLog.create({
          data: {
            actorUserId: ACTOR_USER_ID,
            branchId: cashSession.physicalCashBox.branchId,
            module: "cash_session",
            action: "CASH_SESSION_REPAIR_CLOSED",
            entityType: "CashSession",
            entityId: cashSessionId,
            metadataJson: {
              approvalId: approval.id,
              countedCash,
              expectedCash,
              difference,
              repairScript: true,
            },
          },
        });
      });

      console.log("  REPAIRED — session closed, approval marked EXECUTED");
      repaired++;
    } catch (err) {
      console.error(`  ERROR — ${String(err)}`);
      skipped++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Summary: ${repaired} repaired, ${skipped} skipped  [${DRY_RUN ? "DRY_RUN" : "EXECUTE"}]`);
  console.log("=".repeat(60));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
