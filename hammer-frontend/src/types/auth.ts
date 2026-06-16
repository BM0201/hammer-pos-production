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

export type ModuleFlags = {
  master?: boolean;
  pos?: boolean;
  cash?: boolean;
  warehouse?: boolean;
  dispatch?: boolean;
  inventory?: boolean;
  pricing?: boolean;
  purchases?: boolean;
  transfers?: boolean;
  production?: boolean;
  brain?: boolean;
  users?: boolean;
  sessionMonitor?: boolean;
};

export type SessionBranch = {
  id: string;
  name: string;
  code?: string | null;
  roles: RoleCode[];
  capabilities: string[];
  modules: ModuleFlags;
  activeCashSession?: {
    id: string;
    openedAt: string;
    openingAmount: number;
    status: string;
  } | null;
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
  mustChangePassword?: boolean;
  effectiveCapabilities?: string[];
  modules?: ModuleFlags;
  activeBranchId?: string | null;
  branches?: SessionBranch[];
  exp: number;
};
