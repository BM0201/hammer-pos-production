import type { Prisma, RoleCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/modules/auth/password";
import { validatePasswordPolicy } from "@/modules/auth/password-policy";
import { revokeAllUserSessions } from "@/modules/security/token-revocation";

/**
 * Contraseña inicial universal para TODOS los usuarios nuevos y resets.
 * El usuario SIEMPRE debe cambiarla en su primer login.
 */
const INITIAL_PASSWORD = "ElChele1234!";

function assertInitialPasswordPolicy(): void {
  const error = validatePasswordPolicy(INITIAL_PASSWORD);
  if (error) {
    throw new Error(`CONFIGURATION_ERROR: contrasena inicial insegura: ${error}`);
  }
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export async function listUsersWithMemberships() {
  const users = await prisma.user.findMany({
    where: { NOT: { username: { startsWith: "deleted-" } } },
    orderBy: [{ isActive: "desc" }, { username: "asc" }],
    select: {
      id: true,
      username: true,
      email: true,
      fullName: true,
      isActive: true,
      globalRole: true,
      mustChangePassword: true,
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

  const activeUsernames = new Set(users.filter((user) => user.isActive).map((user) => normalizeUsername(user.username)));
  return users.filter((user) => user.isActive || !activeUsernames.has(normalizeUsername(user.username)));
}

export async function softDeleteUser(userId: string, actorUserId: string) {
  if (userId === actorUserId) {
    throw new Error("VALIDATION_ERROR: no puedes desactivar tu propio usuario");
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, username: true, email: true, isActive: true },
    });

    if (!user.isActive) return { deactivated: true, id: user.id, alreadyInactive: true };

    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        isActive: false,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        actorUserId,
        module: "users",
        action: "USER_DEACTIVATED",
        entityType: "User",
        entityId: userId,
        metadataJson: { username: user.username, email: user.email, membershipsPreserved: true },
      },
    });

    return { deactivated: true, id: updated.id };
  });

  await revokeAllUserSessions(userId, "USER_DEACTIVATED");
  return result;
}

export async function listActiveBranches() {
  return prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
}

export async function listBranchesForMembershipManagement() {
  const branches = await prisma.branch.findMany({
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      branchRoleConfigs: {
        select: { role: true, enabled: true },
      },
    },
  });

  return branches.map((branch) => {
    const configured = new Map(branch.branchRoleConfigs.map((config) => [config.role, config.enabled]));
    return {
      id: branch.id,
      code: branch.code,
      name: branch.name,
      isActive: branch.isActive,
      roleAvailability: {
        BRANCH_ADMIN: configured.get("BRANCH_ADMIN") ?? true,
        SALES: configured.get("SALES") ?? true,
        CASHIER: configured.get("CASHIER") ?? true,
        WAREHOUSE: configured.get("WAREHOUSE") ?? true,
      },
    };
  });
}

type NewMembership = {
  branchId: string;
  roleCode: Exclude<RoleCode, "MASTER" | "OWNER" | "SYSTEM_ADMIN">;
};

const BRANCH_MEMBERSHIP_ROLES: readonly RoleCode[] = ["BRANCH_ADMIN", "SALES", "CASHIER", "WAREHOUSE"];
const PRIVILEGED_GLOBAL_ROLES: readonly RoleCode[] = ["MASTER", "OWNER", "SYSTEM_ADMIN"];

function isBranchMembershipRole(roleCode: RoleCode): boolean {
  return BRANCH_MEMBERSHIP_ROLES.includes(roleCode);
}

function hasPrivilegedGlobalRole(roleCode: RoleCode | null | undefined) {
  return Boolean(roleCode && PRIVILEGED_GLOBAL_ROLES.includes(roleCode));
}

async function countEffectiveActiveMemberships(userId: string, tx: Prisma.TransactionClient = prisma) {
  const memberships = await tx.userBranchRole.findMany({
    where: { userId, isActive: true, branch: { isActive: true } },
    select: { branchId: true, roleCode: true },
  });
  if (memberships.length === 0) return 0;

  const configs = await tx.branchRoleConfig.findMany({
    where: { OR: memberships.map((membership) => ({ branchId: membership.branchId, role: membership.roleCode })) },
    select: { branchId: true, role: true, enabled: true },
  });
  const configByBranchRole = new Map(configs.map((config) => [`${config.branchId}:${config.role}`, config.enabled]));
  return memberships.filter((membership) => configByBranchRole.get(`${membership.branchId}:${membership.roleCode}`) ?? true).length;
}

async function assertActiveNormalUserHasAccess(userId: string, tx: Prisma.TransactionClient = prisma) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true, globalRole: true },
  });
  if (!user) throw new Error("NOT_FOUND: usuario no encontrado");
  if (!user.isActive || hasPrivilegedGlobalRole(user.globalRole)) return;

  const effectiveMemberships = await countEffectiveActiveMemberships(userId, tx);
  if (effectiveMemberships <= 0) {
    throw new Error("VALIDATION_ERROR: un usuario activo sin rol global necesita al menos una membresia efectiva");
  }
}

async function assertAssignableUser(userId: string, tx: Prisma.TransactionClient = prisma) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true, username: true },
  });
  if (!user) throw new Error("VALIDATION_ERROR: usuario no encontrado");
  if (!user.isActive) throw new Error(`VALIDATION_ERROR: el usuario ${user.username} esta inactivo`);
}

async function assertMembershipsCanBeAssigned(
  memberships: Array<{ branchId: string; roleCode: RoleCode }>,
  tx: Prisma.TransactionClient = prisma,
) {
  if (memberships.length === 0) return;

  const branchIds = Array.from(new Set(memberships.map((membership) => membership.branchId)));
  const branches = await tx.branch.findMany({
    where: { id: { in: branchIds } },
    select: { id: true, isActive: true, code: true, name: true },
  });
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));

  for (const branchId of branchIds) {
    const branch = branchById.get(branchId);
    if (!branch) throw new Error("VALIDATION_ERROR: sucursal no encontrada");
    if (!branch.isActive) throw new Error(`VALIDATION_ERROR: la sucursal ${branch.code} esta inactiva`);
  }

  const configs = await tx.branchRoleConfig.findMany({
    where: {
      branchId: { in: branchIds },
      role: { in: memberships.map((membership) => membership.roleCode) },
    },
    select: { branchId: true, role: true, enabled: true },
  });
  const configByBranchRole = new Map(configs.map((config) => [`${config.branchId}:${config.role}`, config.enabled]));

  for (const membership of memberships) {
    if (!isBranchMembershipRole(membership.roleCode)) {
      throw new Error("VALIDATION_ERROR: rol de sucursal invalido");
    }
    const enabled = configByBranchRole.get(`${membership.branchId}:${membership.roleCode}`) ?? true;
    if (!enabled) {
      const branch = branchById.get(membership.branchId);
      throw new Error(`VALIDATION_ERROR: el rol ${membership.roleCode} esta deshabilitado en ${branch?.code ?? "esa sucursal"}`);
    }
  }
}

export async function createUser(input: {
  username: string;
  email?: string;
  fullName: string;
  password?: string; // Se ignora — siempre se usa la contraseña universal ElChele1234!
  isActive?: boolean;
  globalRole?: "MASTER" | "OWNER" | "SYSTEM_ADMIN";
  memberships: NewMembership[];
}) {
  assertInitialPasswordPolicy();

  const username = normalizeUsername(input.username);
  const email = input.email?.trim().toLowerCase() || `${username}@hammer.local`;

  return prisma.$transaction(async (tx) => {
    await assertMembershipsCanBeAssigned(input.memberships, tx);

    const existing = await tx.user.findFirst({
      where: {
        username: { equals: username, mode: "insensitive" },
        NOT: { username: { startsWith: "deleted-" } },
      },
      select: { id: true, username: true, isActive: true },
    });
    if (existing) {
      throw new Error(`VALIDATION_ERROR: ya existe un usuario registrado como ${existing.username}`);
    }

    const user = await tx.user.create({
      data: {
        username,
        email,
        fullName: input.fullName.trim(),
        // SIEMPRE usa la contraseña universal — el usuario la cambiará en su primer login
        passwordHash: hashPassword(INITIAL_PASSWORD),
        isActive: input.isActive ?? true,
        globalRole: input.globalRole ?? null,
        mustChangePassword: true,
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
  actorUserId: string,
  input: {
    email?: string;
    fullName?: string;
    password?: string;
    isActive?: boolean;
    globalRole?: "MASTER" | "OWNER" | "SYSTEM_ADMIN" | null;
  },
) {
  if (typeof input.password === "string") {
    assertInitialPasswordPolicy();
  }

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
    // Admin reset: SIEMPRE usa la contraseña universal ElChele1234!
    data.passwordHash = hashPassword(INITIAL_PASSWORD);
    data.mustChangePassword = true;
  }

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, globalRole: true },
    });
    if (!current) throw new Error("NOT_FOUND: usuario no encontrado");

    if (userId === actorUserId) {
      if (input.isActive === false) {
        throw new Error("VALIDATION_ERROR: no puedes desactivar tu propio usuario");
      }
      if (hasPrivilegedGlobalRole(current.globalRole) && input.globalRole !== undefined && !hasPrivilegedGlobalRole(input.globalRole)) {
        throw new Error("VALIDATION_ERROR: no puedes quitarte tu propio rol global privilegiado");
      }
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data,
    });
    await assertActiveNormalUserHasAccess(userId, tx);
    return updated;
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
  roleCode: Exclude<RoleCode, "MASTER" | "OWNER" | "SYSTEM_ADMIN">;
  isActive?: boolean;
}) {
  const result = await prisma.$transaction(async (tx) => {
    await assertAssignableUser(input.userId, tx);
    await assertMembershipsCanBeAssigned([{ branchId: input.branchId, roleCode: input.roleCode }], tx);

    const membership = await tx.userBranchRole.upsert({
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
    await assertActiveNormalUserHasAccess(input.userId, tx);
    return membership;
  });

  // Branch membership changes affect session payload → invalidate sessions
  await revokeAllUserSessions(input.userId, "BRANCH_ROLE_CHANGE");

  return result;
}

export async function updateMembership(
  userId: string,
  membershipId: string,
  input: { roleCode?: Exclude<RoleCode, "MASTER" | "OWNER" | "SYSTEM_ADMIN">; isActive?: boolean },
) {
  const result = await prisma.$transaction(async (tx) => {
  await assertAssignableUser(userId, tx);
  const membership = await tx.userBranchRole.findUniqueOrThrow({
    where: { id: membershipId },
    select: { id: true, userId: true, branchId: true, roleCode: true },
  });

  if (membership.userId !== userId) {
    throw new Error("NOT_FOUND: membresía no encontrada para el usuario indicado");
  }

  let result;
  if (input.roleCode && input.roleCode !== membership.roleCode) {
    await assertMembershipsCanBeAssigned([{ branchId: membership.branchId, roleCode: input.roleCode }], tx);

    await tx.userBranchRole.delete({ where: { id: membership.id } });
    result = await tx.userBranchRole.upsert({
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
    result = await tx.userBranchRole.update({
      where: { id: membership.id },
      data: {
        ...(typeof input.isActive === "boolean" ? { isActive: input.isActive } : {}),
      },
    });
  }

  await assertActiveNormalUserHasAccess(userId, tx);
  return result;
  });

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
  const result = await prisma.$transaction(async (tx) => {
  const membership = await tx.userBranchRole.findUniqueOrThrow({
    where: { id: membershipId },
    select: { id: true, userId: true },
  });
  if (membership.userId !== userId) {
    throw new Error("NOT_FOUND: membresía no encontrada para el usuario indicado");
  }

  const deleted = await tx.userBranchRole.delete({
    where: { id: membership.id },
  });
  await assertActiveNormalUserHasAccess(userId, tx);
  return deleted;
  });

  // Removing a membership changes the session payload → invalidate sessions
  await revokeAllUserSessions(userId, "BRANCH_MEMBERSHIP_REMOVED");

  return result;
}
