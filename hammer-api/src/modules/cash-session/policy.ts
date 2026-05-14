import type { RoleCode } from "@prisma/client";

const CASH_SESSION_OPERATOR_ROLES: RoleCode[] = ["CASHIER", "BRANCH_ADMIN", "MASTER"];

export function canOperateCashSession(role: RoleCode): boolean {
  return CASH_SESSION_OPERATOR_ROLES.includes(role);
}
