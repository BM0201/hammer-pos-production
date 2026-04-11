import type { Prisma, RoleCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/modules/auth/password";

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
  const data: Prisma.UserUpdateInput = {};
  if (typeof input.email === "string") data.email = input.email;
  if (typeof input.fullName === "string") data.fullName = input.fullName;
  if (typeof input.isActive === "boolean") data.isActive = input.isActive;
  if (input.globalRole !== undefined) data.globalRole = input.globalRole;
  if (typeof input.password === "string") data.passwordHash = hashPassword(input.password);

  return prisma.user.update({
    where: { id: userId },
    data,
  });
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

  return prisma.userBranchRole.upsert({
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

  if (input.roleCode && input.roleCode !== membership.roleCode) {
    await prisma.userBranchRole.delete({ where: { id: membership.id } });
    return prisma.userBranchRole.upsert({
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
  }

  return prisma.userBranchRole.update({
    where: { id: membership.id },
    data: {
      ...(typeof input.isActive === "boolean" ? { isActive: input.isActive } : {}),
    },
  });
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

  return prisma.userBranchRole.delete({
    where: { id: membership.id },
  });
}
