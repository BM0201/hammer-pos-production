import type { RoleCode } from "@prisma/client";

const DISPATCH_ROLES: RoleCode[] = ["WAREHOUSE", "BRANCH_ADMIN", "MASTER"];

export function canDispatchOrders(role: RoleCode): boolean {
  return DISPATCH_ROLES.includes(role);
}
