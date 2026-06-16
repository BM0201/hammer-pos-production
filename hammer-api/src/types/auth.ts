import type { RoleCode } from "@prisma/client";

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
