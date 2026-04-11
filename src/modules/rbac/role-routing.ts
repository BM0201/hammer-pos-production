export type AppRoleCode =
  | "SYSTEM_ADMIN"
  | "OWNER"
  | "MASTER"
  | "BRANCH_ADMIN"
  | "SALES"
  | "CASHIER"
  | "WAREHOUSE"
  | string;

export function isSystemAdminRole(roleCode: string, globalRoles?: readonly string[]) {
  return roleCode === "SYSTEM_ADMIN" || Boolean(globalRoles?.includes("SYSTEM_ADMIN"));
}

export function isOwnerRole(roleCode: string, globalRoles?: readonly string[]) {
  return roleCode === "OWNER" || Boolean(globalRoles?.includes("OWNER"));
}

export function isMasterRole(roleCode: string, globalRoles?: readonly string[]) {
  return roleCode === "MASTER" || Boolean(globalRoles?.includes("MASTER"));
}

/** OWNER has at least MASTER-level access */
export function isMasterOrAbove(roleCode: string, globalRoles?: readonly string[]) {
  return isMasterRole(roleCode, globalRoles) || isOwnerRole(roleCode, globalRoles) || isSystemAdminRole(roleCode, globalRoles);
}

export function resolveRoleHome(roleCode: AppRoleCode, globalRoles: readonly string[] = []): string {
  if (isSystemAdminRole(roleCode, globalRoles)) return "/app/system-admin";
  if (isOwnerRole(roleCode, globalRoles)) return "/app/owner";
  if (isMasterRole(roleCode, globalRoles)) return "/app/master";
  if (roleCode === "BRANCH_ADMIN" || roleCode === "SALES") return "/app/branch/sales/orders";
  if (roleCode === "CASHIER") return "/app/branch/cashier/payments";
  if (roleCode === "WAREHOUSE") return "/app/branch/warehouse/dispatch";
  return "/app/branch";
}
