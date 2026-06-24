/**
 * repair-brain-decisions.ts
 *
 * Repairs three classes of Brain decision inconsistencies:
 *
 * 1. STALE_EXECUTING  — decisions stuck in EXECUTING > 10 min → set to FAILED
 * 2. REOPEN_EXPIRED   — EXPIRED decisions whose problem was re-detected (lastDetectedAt
 *                        is recent) → reopen as OPEN so they show up in the dashboard
 * 3. DEDUP_FINGERPRINT — duplicate decisions sharing the same fingerprint from the old
 *                        `cash:auto-close-review:<id>` format that are now superseded by
 *                        the hashed fingerprint used by cash-detector → mark oldest as DISMISSED
 *
 * Usage:
 *   # Dry-run (default — no DB writes):
 *   DRY_RUN=true npx tsx src/scripts/repair-brain-decisions.ts
 *
 *   # Execute for real:
 *   DRY_RUN=false REPAIR_ACTOR_USER_ID=<master-user-id> npx tsx src/scripts/repair-brain-decisions.ts
 */

import { prisma } from "@/lib/prisma";

const DRY_RUN = process.env.DRY_RUN !== "false";
const ACTOR_USER_ID = process.env.REPAIR_ACTOR_USER_ID ?? "system-repair";
const STALE_EXECUTING_MINUTES = 10;
const REOPEN_IF_DETECTED_WITHIN_DAYS = 3;

function log(msg: string) {
  console.log(msg);
}

async function repairStaleExecuting() {
  const threshold = new Date(Date.now() - STALE_EXECUTING_MINUTES * 60 * 1000);
  const stale = await prisma.brainDecision.findMany({
    where: { status: "EXECUTING", updatedAt: { lt: threshold } },
    select: { id: true, fingerprint: true, updatedAt: true },
  });

  log(`\n[STALE_EXECUTING] Found ${stale.length} decision(s) stuck in EXECUTING.`);
  let fixed = 0;

  for (const d of stale) {
    log(`  ${d.id.slice(0, 8)}… fingerprint=${d.fingerprint.slice(0, 12)}… stuck since ${d.updatedAt.toISOString()}`);
    if (DRY_RUN) { fixed++; continue; }
    await prisma.brainDecision.update({
      where: { id: d.id },
      data: { status: "FAILED", actionResultJson: { error: "STALE_EXECUTING: reparado por script" } },
    });
    await prisma.brainDecisionActionLog.create({
      data: { decisionId: d.id, actorUserId: ACTOR_USER_ID, action: "FAILED", note: "Reparado por repair-brain-decisions.ts: STALE_EXECUTING" },
    });
    fixed++;
  }
  log(`  → ${fixed} reparados${DRY_RUN ? " [DRY_RUN]" : ""}`);
  return fixed;
}

async function repairExpiredRedetected() {
  const recentThreshold = new Date(Date.now() - REOPEN_IF_DETECTED_WITHIN_DAYS * 24 * 60 * 60 * 1000);
  const expired = await prisma.brainDecision.findMany({
    where: { status: "EXPIRED", lastDetectedAt: { gte: recentThreshold } },
    select: { id: true, fingerprint: true, lastDetectedAt: true, title: true },
  });

  log(`\n[REOPEN_EXPIRED] Found ${expired.length} EXPIRED decision(s) re-detected in last ${REOPEN_IF_DETECTED_WITHIN_DAYS} days.`);
  let reopened = 0;

  for (const d of expired) {
    log(`  ${d.id.slice(0, 8)}… lastDetected=${d.lastDetectedAt?.toISOString()} title="${d.title.slice(0, 60)}"`);
    if (DRY_RUN) { reopened++; continue; }
    await prisma.brainDecision.update({
      where: { id: d.id },
      data: { status: "OPEN", resolvedAt: null },
    });
    await prisma.brainDecisionActionLog.create({
      data: { decisionId: d.id, actorUserId: ACTOR_USER_ID, action: "REOPENED", note: "Reabierto por repair-brain-decisions.ts: problema re-detectado" },
    });
    reopened++;
  }
  log(`  → ${reopened} reabiertos${DRY_RUN ? " [DRY_RUN]" : ""}`);
  return reopened;
}

async function repairLegacyAutoCloseFingerprints() {
  // Old fingerprint format: "cash:auto-close-review:<sessionId>" (plain string, not hashed)
  // These are raw strings stored in the fingerprint column that look like "cash:auto-close-review:<uuid>"
  const legacy = await prisma.brainDecision.findMany({
    where: { fingerprint: { startsWith: "cash:auto-close-review:" } },
    select: { id: true, fingerprint: true, status: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  log(`\n[DEDUP_FINGERPRINT] Found ${legacy.length} legacy auto-close fingerprint decision(s).`);
  let dismissed = 0;

  for (const d of legacy) {
    log(`  ${d.id.slice(0, 8)}… fingerprint=${d.fingerprint} status=${d.status}`);
    if (DRY_RUN) { dismissed++; continue; }
    if (d.status === "DISMISSED" || d.status === "EXECUTED") {
      log("    → Already closed, skip");
      continue;
    }
    await prisma.brainDecision.update({
      where: { id: d.id },
      data: { status: "DISMISSED", resolvedAt: new Date() },
    });
    await prisma.brainDecisionActionLog.create({
      data: { decisionId: d.id, actorUserId: ACTOR_USER_ID, action: "DISMISSED", note: "Fingerprint legacy cash:auto-close-review: reemplazado por hash SHA256" },
    });
    dismissed++;
  }
  log(`  → ${dismissed} descartados${DRY_RUN ? " [DRY_RUN]" : ""}`);
  return dismissed;
}

async function main() {
  console.log("=".repeat(64));
  console.log(`repair-brain-decisions  [${DRY_RUN ? "DRY_RUN" : "EXECUTE"}]  actor=${ACTOR_USER_ID}`);
  console.log("=".repeat(64));

  const staleFixed = await repairStaleExecuting();
  const expired = await repairExpiredRedetected();
  const legacyFixed = await repairLegacyAutoCloseFingerprints();

  console.log("\n" + "=".repeat(64));
  console.log(`Summary: ${staleFixed} STALE_EXECUTING fixed, ${expired} EXPIRED reopened, ${legacyFixed} legacy fingerprints dismissed  [${DRY_RUN ? "DRY_RUN" : "EXECUTE"}]`);
  console.log("=".repeat(64));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
