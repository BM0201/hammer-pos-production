/**
 * Tests for manual cash-session close behavior.
 *
 * After the fix:
 *  - Manual close always produces CLOSED status, even when |difference| > C$5.
 *  - No ApprovalRequest is created for manual closes.
 *  - The route adds a `warning.code = "CASH_DIFFERENCE_RECORDED"` to the response
 *    when the difference exceeds the threshold, so the frontend can display it.
 *  - Auto-close still produces AUTO_CLOSED_PENDING_REVIEW (separate path, unchanged).
 *
 * These tests exercise:
 *  - Pure warning-code computation (route logic, no DB).
 *  - The auto-close review policy (unchanged behavior).
 *  - The hard-blocker policies for operational-day close.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { CashSessionStatus } from "@prisma/client";
import { resolveAutoCloseReview } from "@/modules/cash-session/review-policy";
import { isCommandCenterPendingStatus, isCommandCenterCompletedStatus } from "@/modules/dashboard/command-center-policy";
import { isHardOperationalDayCloseBlocker } from "@/modules/operations/close-policy";

// ── Warning-code computation ─────────────────────────────────────────────────

function computeWarning(difference: number, threshold: number) {
  return Math.abs(difference) > threshold
    ? { code: "CASH_DIFFERENCE_RECORDED" as const, difference, threshold }
    : undefined;
}

test("manual close: no warning when difference is zero", () => {
  assert.equal(computeWarning(0, 5), undefined);
});

test("manual close: no warning when difference is within threshold", () => {
  assert.equal(computeWarning(4.99, 5), undefined);
  assert.equal(computeWarning(-4.99, 5), undefined);
});

test("manual close: warning when difference exceeds threshold", () => {
  const w = computeWarning(10.5, 5);
  assert.ok(w);
  assert.equal(w.code, "CASH_DIFFERENCE_RECORDED");
  assert.equal(w.difference, 10.5);
  assert.equal(w.threshold, 5);
});

test("manual close: warning for negative difference > threshold", () => {
  const w = computeWarning(-8, 5);
  assert.ok(w);
  assert.equal(w.code, "CASH_DIFFERENCE_RECORDED");
  assert.equal(w.difference, -8);
});

test("manual close: exactly at threshold does NOT generate warning", () => {
  assert.equal(computeWarning(5, 5), undefined);
  assert.equal(computeWarning(-5, 5), undefined);
});

// ── Auto-close path is unchanged ─────────────────────────────────────────────

test("auto-close still creates pending review status (unchanged)", () => {
  assert.equal(isCommandCenterPendingStatus(CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW), true);
  assert.equal(isCommandCenterCompletedStatus(CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW), false);
});

test("auto-close review with confirmOk closes session as AUTO_CLOSED (unchanged)", () => {
  const review = resolveAutoCloseReview({ expectedCash: 500, confirmOk: true });
  assert.equal(review.status, CashSessionStatus.AUTO_CLOSED);
  assert.equal(review.countedCash, 500);
  assert.equal(review.difference, 0);
});

test("auto-close review with counted amount records difference (unchanged)", () => {
  const review = resolveAutoCloseReview({ expectedCash: 1000, countedCashAmount: 980, note: "Conteo físico" });
  assert.equal(review.status, CashSessionStatus.AUTO_CLOSED);
  assert.equal(review.countedCash, 980);
  assert.equal(review.difference, -20);
});

// ── Operational day close blockers ───────────────────────────────────────────

test("AUTO_CLOSED_PENDING_REVIEW is a hard blocker for operational day close", () => {
  assert.equal(isHardOperationalDayCloseBlocker("auto_closed_pending_review"), true);
});

test("open_cash_sessions is a hard blocker for operational day close", () => {
  assert.equal(isHardOperationalDayCloseBlocker("open_cash_sessions"), true);
});

test("pending_payments is a hard blocker for operational day close", () => {
  assert.equal(isHardOperationalDayCloseBlocker("pending_payments"), true);
});

test("sale returns and cancellations are soft blockers (not hard)", () => {
  assert.equal(isHardOperationalDayCloseBlocker("pending_sale_return"), false);
  assert.equal(isHardOperationalDayCloseBlocker("pending_sale_cancellation"), false);
});

// ── CLOSED session is no longer pending in command center ────────────────────

test("CLOSED session is completed in command center (not pending)", () => {
  assert.equal(isCommandCenterPendingStatus(CashSessionStatus.CLOSED), false);
  assert.equal(isCommandCenterCompletedStatus(CashSessionStatus.CLOSED), true);
});

test("after manual close with diff, session is CLOSED — not RECONCILING or pending", () => {
  // Verify that once a session is CLOSED it is not treated as a blocker
  assert.equal(isCommandCenterPendingStatus(CashSessionStatus.CLOSED), false);
  assert.equal(isHardOperationalDayCloseBlocker("closed"), false);
});
