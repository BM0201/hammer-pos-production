import { CashSessionStatus } from "@prisma/client";

const PENDING_STATUSES: CashSessionStatus[] = [
  CashSessionStatus.OPEN,
  CashSessionStatus.RECONCILING,
  CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW,
];

const COMPLETED_STATUSES: CashSessionStatus[] = [
  CashSessionStatus.CLOSED,
  CashSessionStatus.AUTO_CLOSED,
  CashSessionStatus.PERMANENTLY_CLOSED,
];

export function isCommandCenterPendingStatus(status: CashSessionStatus) {
  return PENDING_STATUSES.includes(status);
}

export function isCommandCenterCompletedStatus(status: CashSessionStatus) {
  return COMPLETED_STATUSES.includes(status);
}

export function commandCenterPendingStatuses() {
  return [...PENDING_STATUSES];
}

export function commandCenterCompletedStatuses() {
  return [...COMPLETED_STATUSES];
}
