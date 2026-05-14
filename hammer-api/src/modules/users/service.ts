import type { Prisma, RoleCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/modules/auth/password";
import { revokeAllUserSessions } from "@/modules/security/token-revocation";

export async function listUsersWithMemberships() {
  return prisma.user.findMany({
    orderBy: { username: "asc" },
    select: {
      id: true,
      username: true,
      email: true,
      fullName: true,
      isActive: true,
      globalRole: true,
      createdAt: true,
      userBranchRoles: {
        orderBy: [{ branch: { code: "asc" } }, { roleCode: "asc" }],
        select: {
          id: true,
          branchId: true,
          roleCode: true,
          isActive: true,
          branch: { select: { code: true, name: true } },
        },
      },
    },
  });
}

export async function listActiveBranches() {
  return prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
}

export async function listBranchesForMembershipManagement() {
  return prisma.branch.findMany({
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, isActive: true },
  });
}

type NewMembership = {
  branchId: string;
  roleCode: Exclude<RoleCode, "MASTER">;
};

export async function createUser(input: {
  username: string;
  email: string;
  fullName: string;
  password: string;
  isActive?: boolean;
  globalRole?: "MASTER";
  memberships: NewMembership[];
}) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username: input.username,
        email: input.email,
        fullName: input.fullName,
        passwordHash: hashPassword(input.password),
        isActive: input.isActive ?? true,
        globalRole: input.globalRole ?? null,
      },
      select: { id: true },
    });

    if (input.memberships.length > 0) {
      await tx.userBranchRole.createMany({
        data: input.memberships.map((membership) => ({
          userId: user.id,
          branchId: membership.branchId,
          roleCode: membership.roleCode,
          isActive: true,
        })),
      });
    }

    return user;
  });
}

export async function updateUser(
  userId: string,
  input: {
    email?: string;
    fullName?: string;
    password?: string;
    isActive?: boolean;
    globalRole?: "MASTER" | null;
  },
) {
  // Determine if this change requires session invalidation
  const requiresSessionRevocation =
    typeof input.password === "string" ||       // Password reset by admin
    typeof input.isActive === "boolean" ||       // Activation/deactivation
    input.globalRole !== undefined;               // Global role change

  const data: Prisma.UserUpdateInput = {};
  if (typeof input.email === "string") data.email = input.email;
  if (typeof input.fullName === "string") data.fullName = input.fullName;
  if (typeof input.isActive === "boolean") data.isActive = input.isActive;
  if (input.globalRole !== undefined) data.globalRole = input.globalRole;
  if (typeof input.password === "string") {
    data.passwordHash = hashPassword(input.password);
    data.mustChangePassword = true;
  }

  const result = await prisma.user.update({
    where: { id: userId },
    data,
  });

  // Revoke all sessions when security-critical fields change
  if (requiresSessionRevocation) {
    const reason = typeof input.password === "string"
      ? "ADMIN_PASSWORD_RESET"
      : input.isActive === false
      ? "USER_DEACTIVATED"
      : "GLOBAL_ROLE_CHANGE";
    await revokeAllUserSessions(userId, reason);
  }

  return result;
}

export async function upsertMembership(input: {
  userId: string;
  branchId: string;
  roleCode: Exclude<RoleCode, "MASTER">;
  isActive?: boolean;
}) {
  await prisma.branch.findUniqueOrThrow({
    where: { id: input.branchId },
    select: { id: true },
  });

  const result = await prisma.userBranchRole.upsert({
    where: {
      userId_branchId_roleCode: {
        userId: input.userId,
        branchId: input.branchId,
        roleCode: input.roleCode,
      },
    },
    update: { isActive: input.isActive ?? true },
    create: {
      userId: input.userId,
      branchId: input.branchId,
      roleCode: input.roleCode,
      isActive: input.isActive ?? true,
    },
  });

  // Branch membership changes affect session payload → invalidate sessions
  await revokeAllUserSessions(input.userId, "BRANCH_ROLE_CHANGE");

  return result;
}

export async function updateMembership(
  userId: string,
  membershipId: string,
  input: { roleCode?: Exclude<RoleCode, "MASTER">; isActive?: boolean },
) {
  const membership = await prisma.userBranchRole.findUniqueOrThrow({
    where: { id: membershipId },
    select: { id: true, userId: true, branchId: true, roleCode: true },
  });

  if (membership.userId !== userId) {
    throw new Error("NOT_FOUND: membresía no encontrada para el usuario indicado");
  }

  let result;
  if (input.roleCode && input.roleCode !== membership.roleCode) {
    await prisma.userBranchRole.delete({ where: { id: membership.id } });
    result = await prisma.userBranchRole.upsert({
      where: {
        userId_branchId_roleCode: {
          userId: membership.userId,
          branchId: membership.branchId,
          roleCode: input.roleCode,
        },
      },
      update: { isActive: input.isActive ?? true },
      create: {
        userId: membership.userId,
        branchId: membership.branchId,
        roleCode: input.roleCode,
        isActive: input.isActive ?? true,
      },
    });
  } else {
    result = await prisma.userBranchRole.update({
      where: { id: membership.id },
      data: {
        ...(typeof input.isActive === "boolean" ? { isActive: input.isActive } : {}),
      },
    });
  }

  // Membership role/status changes affect session payload → invalidate sessions
  await revokeAllUserSessions(userId, "BRANCH_ROLE_CHANGE");

  return result;
}

export async function removeMembership(membershipId: string) {
  return prisma.userBranchRole.delete({
    where: { id: membershipId },
  });
}

export async function removeMembershipFromUser(userId: string, membershipId: string) {
  const membership = await prisma.userBranchRole.findUniqueOrThrow({
    where: { id: membershipId },
    select: { id: true, userId: true },
  });
  if (membership.userId !== userId) {
    throw new Error("NOT_FOUND: membresía no encontrada para el usuario indicado");
  }

  const result = await prisma.userBranchRole.delete({
    where: { id: membership.id },
  });

  // Removing a membership changes the session payload → invalidate sessions
  await revokeAllUserSessions(userId, "BRANCH_MEMBERSHIP_REMOVED");

  return result;
}
