// Local copy of RoleCode enum — keeps frontend decoupled from @prisma/client.
// Must stay in sync with prisma/schema.prisma (RoleCode enum) in the backend.
export type RoleCode =
  | "SYSTEM_ADMIN"
  | "OWNER"
  | "MASTER"
  | "BRANCH_ADMIN"
  | "SALES"
  | "CASHIER"
  | "WAREHOUSE";

export type BranchMembership = {
  branchId: string;
  roleCode: RoleCode;
};

export type SessionPayload = {
  userId: string;
  username: string;
  globalRoles: RoleCode[];
  branchMemberships: BranchMembership[];
  primaryBranchId: string | null;
  roleCode: RoleCode;
  branchIds: string[];
  sessionVersion: number;
  exp: number;
};
