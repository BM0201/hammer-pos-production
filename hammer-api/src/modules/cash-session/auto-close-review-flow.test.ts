import assert from "node:assert/strict";
import test from "node:test";
import { CashSessionStatus } from "@prisma/client";
import { resolveAutoCloseReview } from "@/modules/cash-session/review-policy";
import { isCommandCenterCompletedStatus, isCommandCenterPendingStatus } from "@/modules/dashboard/command-center-policy";
import { isHardOperationalDayCloseBlocker } from "@/modules/operations/close-policy";

test("auto-close creates a pending review status", () => {
  assert.equal(isCommandCenterPendingStatus(CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW), true);
  assert.equal(isCommandCenterCompletedStatus(CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW), false);
});

test("operational day cannot force-close with pending auto-close review", () => {
  assert.equal(isHardOperationalDayCloseBlocker("auto_closed_pending_review"), true);
});

test("master confirm OK uses expected cash and leaves session AUTO_CLOSED", () => {
  const review = resolveAutoCloseReview({ expectedCash: 1250.75, confirmOk: true });

  assert.equal(review.status, CashSessionStatus.AUTO_CLOSED);
  assert.equal(review.countedCash, 1250.75);
  assert.equal(review.difference, 0);
  assert.equal(review.requiresReview, false);
});

test("register difference calculates counted minus expected and leaves AUTO_CLOSED", () => {
  const review = resolveAutoCloseReview({ expectedCash: 1000, countedCashAmount: 970, note: "Faltante contado" });

  assert.equal(review.status, CashSessionStatus.AUTO_CLOSED);
  assert.equal(review.countedCash, 970);
  assert.equal(review.difference, -30);
  assert.equal(review.requiresReview, false);
});

test("command center no longer shows reviewed auto-close as pending", () => {
  const review = resolveAutoCloseReview({ expectedCash: 500, confirmOk: true });

  assert.equal(isCommandCenterPendingStatus(review.status), false);
  assert.equal(isCommandCenterCompletedStatus(review.status), true);
});

test("operational day close can proceed after pending auto-close review is resolved", () => {
  assert.equal(isHardOperationalDayCloseBlocker("auto_closed_pending_review"), true);
  assert.equal(isCommandCenterPendingStatus(CashSessionStatus.AUTO_CLOSED), false);
  assert.equal(isCommandCenterCompletedStatus(CashSessionStatus.AUTO_CLOSED), true);
});
