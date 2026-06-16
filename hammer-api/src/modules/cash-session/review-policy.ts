import { CashSessionStatus } from "@prisma/client";

export type AutoCloseReviewInput = {
  expectedCash: number;
  countedCashAmount?: number;
  confirmOk?: boolean;
  note?: string | null;
};

export function resolveAutoCloseReview(input: AutoCloseReviewInput) {
  const countedCash = input.confirmOk ? input.expectedCash : Number(input.countedCashAmount);
  if (!Number.isFinite(countedCash)) {
    throw new Error("CASH_SESSION_REVIEW_COUNTED_AMOUNT_REQUIRED");
  }
  const note = input.confirmOk
    ? (input.note?.trim() || "Revision automatica confirmada OK por Master.")
    : input.note?.trim();
  if (!input.confirmOk && (!note || note.length < 5)) {
    throw new Error("CASH_SESSION_REVIEW_NOTE_REQUIRED");
  }

  const difference = countedCash - input.expectedCash;
  return {
    status: CashSessionStatus.AUTO_CLOSED,
    countedCash,
    difference,
    requiresReview: false,
    note,
  };
}
