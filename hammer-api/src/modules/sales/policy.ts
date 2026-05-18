import type { RoleCode } from "@prisma/client";

const SALES_DRAFT_MANAGER_ROLES: RoleCode[] = ["MASTER", "BRANCH_ADMIN", "SALES"];
const SALES_VIEW_ROLES: RoleCode[] = ["MASTER", "BRANCH_ADMIN", "SALES", "CASHIER"];

export function canManageSalesDraft(role: RoleCode): boolean {
  return SALES_DRAFT_MANAGER_ROLES.includes(role);
}

export function canViewSales(role: RoleCode): boolean {
  return SALES_VIEW_ROLES.includes(role);
}
