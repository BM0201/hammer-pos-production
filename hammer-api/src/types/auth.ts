import type { RoleCode } from "@prisma/client";

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
