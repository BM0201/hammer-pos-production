import type { RoleCode } from "@prisma/client";

const PAYMENT_POSTING_ROLES: RoleCode[] = ["CASHIER", "MASTER"];
const PAYMENT_VIEW_ROLES: RoleCode[] = ["CASHIER", "MASTER", "BRANCH_ADMIN"];

export function canPostPayment(role: RoleCode): boolean {
  return PAYMENT_POSTING_ROLES.includes(role);
}

export function canViewPendingPayments(role: RoleCode): boolean {
  return PAYMENT_VIEW_ROLES.includes(role);
}
