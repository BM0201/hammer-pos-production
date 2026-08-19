import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import type { RoleCode } from "@prisma/client";

/* ═══════════════════════════════════════════════════════════════
   Branch Role Configuration
   ═══════════════════════════════════════════════════════════════ */

export async function listBranchRoleConfigs() {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  const configs = await prisma.branchRoleConfig.findMany({
    include: { updatedBy: { select: { id: true, username: true } } },
  });
  const configMap = new Map<string, typeof configs>();
  for (const c of configs) {
    const key = c.branchId;
    if (!configMap.has(key)) configMap.set(key, []);
    configMap.get(key)!.push(c);
  }
  return branches.map((b) => ({
    branch: b,
    roles: configMap.get(b.id) ?? [],
  }));
}

export async function updateBranchRoleConfig(input: {
  branchId: string;
  role: RoleCode;
  enabled: boolean;
  actorUserId: string;
}) {
  // Use transaction: upsert config + invalidate affected users' sessions
  return prisma.$transaction(async (tx) => {
    const result = await tx.branchRoleConfig.upsert({
      where: { branchId_role: { branchId: input.branchId, role: input.role } },
      update: { enabled: input.enabled, updatedByUserId: input.actorUserId },
      create: {
        branchId: input.branchId,
        role: input.role,
        enabled: input.enabled,
        updatedByUserId: input.actorUserId,
      },
    });

    // Invalidate sessions of affected users by incrementing sessionVersion
    const affectedUsers = await tx.userBranchRole.findMany({
      where: { branchId: input.branchId, roleCode: input.role, isActive: true },
      select: { userId: true },
    });
    const affectedUserIds = [...new Set(affectedUsers.map((u) => u.userId))];

    if (affectedUserIds.length > 0) {
      await tx.user.updateMany({
        where: { id: { in: affectedUserIds } },
        data: { sessionVersion: { increment: 1 } },
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        module: "system-admin",
        action: "BRANCH_ROLE_CONFIG_UPDATED",
        entityType: "BranchRoleConfig",
        entityId: result.id,
        metadataJson: {
          role: input.role,
          enabled: input.enabled,
          affectedUserCount: affectedUserIds.length,
        },
      },
    });

    return result;
  });
}

/* ═══════════════════════════════════════════════════════════════
   System Settings
   ═══════════════════════════════════════════════════════════════ */

export async function getSystemSettings() {
  return prisma.systemSetting.findMany({ orderBy: { key: "asc" } });
}

export async function updateSystemSetting(key: string, value: string, actorUserId: string) {
  const result = await prisma.systemSetting.upsert({
    where: { key },
    update: { value, updatedByUserId: actorUserId },
    create: { key, value, updatedByUserId: actorUserId },
  });
  await logAuditEvent({
    actorUserId,
    module: "system-admin",
    action: "SYSTEM_SETTING_UPDATED",
    entityType: "SystemSetting",
    entityId: result.id,
    metadataJson: { key, value },
  });
  return result;
}
