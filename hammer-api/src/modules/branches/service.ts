import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CreateBranchInput, UpdateBranchInput } from "@/modules/branches/validators";

const BRANCH_ROLES = ["BRANCH_ADMIN", "SALES", "CASHIER", "WAREHOUSE"] as const;
const BLOCKING_CASH_STATUSES = ["OPEN", "RECONCILING"] as const;
const BLOCKING_ORDER_STATUSES = ["DRAFT", "PENDING_PAYMENT", "PAID", "DISPATCH_PENDING"] as const;
const BLOCKING_DISPATCH_STATUSES = ["PENDING", "IN_PROGRESS"] as const;

function normalizeBranchCode(code: string) {
  return code.trim().replace(/\s+/g, "").toUpperCase();
}

function assertValidBranchCode(code: string) {
  if (!/^[A-Z0-9_-]{2,24}$/.test(code)) {
    throw new Error("INVALID_INPUT: Codigo de sucursal invalido. Use letras, numeros, guion o guion bajo.");
  }
}

function branchInclude() {
  return {
    moduleConfig: true,
    printSettings: true,
    physicalCashBoxes: {
      orderBy: { code: "asc" as const },
      include: { _count: { select: { sessions: true } } },
    },
    userBranchRoles: {
      where: { isActive: true },
      orderBy: [{ roleCode: "asc" as const }, { user: { username: "asc" as const } }],
      include: {
        user: { select: { id: true, username: true, fullName: true, email: true, isActive: true } },
      },
    },
    _count: {
      select: {
        saleOrders: true,
        inventoryBalances: true,
      },
    },
  } satisfies Prisma.BranchInclude;
}

export async function listMasterBranches() {
  return prisma.branch.findMany({
    include: branchInclude(),
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
  });
}

export async function createMasterBranch(input: CreateBranchInput, actorUserId: string) {
  const code = normalizeBranchCode(input.code);
  assertValidBranchCode(code);

  const name = input.name.trim();
  const enableCashier = input.enableCashier ?? true;
  const enableDispatch = input.enableDispatch ?? true;
  const createDefaultCashBox = input.createDefaultCashBox ?? true;
  const memberships = input.memberships ?? [];
  const assignedUserIds = Array.from(new Set(memberships.map((membership) => membership.userId)));

  return prisma.$transaction(async (tx) => {
    if (assignedUserIds.length > 0) {
      const users = await tx.user.findMany({
        where: { id: { in: assignedUserIds } },
        select: { id: true, username: true, isActive: true },
      });
      const userById = new Map(users.map((user) => [user.id, user]));
      for (const userId of assignedUserIds) {
        const user = userById.get(userId);
        if (!user) throw new Error("VALIDATION_ERROR: usuario de membresia no encontrado");
        if (!user.isActive) throw new Error(`VALIDATION_ERROR: el usuario ${user.username} esta inactivo`);
      }
    }

    const branch = await tx.branch.create({
      data: {
        code,
        name,
        isActive: input.isActive ?? true,
      },
    });

    await tx.branchModuleConfig.create({
      data: {
        branchId: branch.id,
        enableCashier,
        enableDispatch,
        updatedByUserId: actorUserId,
      },
    });

    if (createDefaultCashBox) {
      const cashBox = await tx.physicalCashBox.create({
        data: {
          branchId: branch.id,
          code: `CASH-${code}-01`,
          description: `Caja principal ${name}`,
          isActive: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          branchId: branch.id,
          module: "branches",
          action: "PHYSICAL_CASH_BOX_CREATED",
          entityType: "PhysicalCashBox",
          entityId: cashBox.id,
          metadataJson: { code: cashBox.code, description: cashBox.description },
        },
      });
    }

    await tx.printSettings.create({
      data: { branchId: branch.id },
    });

    await tx.branchRoleConfig.createMany({
      data: BRANCH_ROLES.map((role) => ({
        branchId: branch.id,
        role,
        enabled: true,
        updatedByUserId: actorUserId,
      })),
    });

    if (memberships.length > 0) {
      await tx.userBranchRole.createMany({
        data: memberships.map((membership) => ({
          branchId: branch.id,
          userId: membership.userId,
          roleCode: membership.roleCode,
          isActive: true,
        })),
        skipDuplicates: true,
      });

      await tx.user.updateMany({
        where: { id: { in: assignedUserIds } },
        data: { sessionVersion: { increment: 1 } },
      });

      await tx.auditLog.createMany({
        data: memberships.map((membership) => ({
          actorUserId,
          branchId: branch.id,
          module: "branches",
          action: "INITIAL_MEMBERSHIP_ASSIGNED",
          entityType: "UserBranchRole",
          entityId: membership.userId,
          metadataJson: { userId: membership.userId, roleCode: membership.roleCode },
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId,
        branchId: branch.id,
        module: "branches",
        action: "BRANCH_CREATED",
        entityType: "Branch",
        entityId: branch.id,
        metadataJson: {
          code,
          name,
          isActive: branch.isActive,
          createDefaultCashBox,
          enableCashier,
          enableDispatch,
          memberships,
        },
      },
    });

    return tx.branch.findUniqueOrThrow({
      where: { id: branch.id },
      include: branchInclude(),
    });
  });
}

export async function updateMasterBranch(branchId: string, input: UpdateBranchInput, actorUserId: string) {
  return prisma.$transaction(async (tx) => {
    if (input.isActive === false) {
      const [openCashSessions, pendingOrders, activeDispatches] = await Promise.all([
        tx.cashSession.count({
          where: { status: { in: [...BLOCKING_CASH_STATUSES] }, physicalCashBox: { branchId } },
        }),
        tx.saleOrder.count({
          where: { branchId, status: { in: [...BLOCKING_ORDER_STATUSES] } },
        }),
        tx.dispatchTicket.count({
          where: { branchId, status: { in: [...BLOCKING_DISPATCH_STATUSES] } },
        }),
      ]);

      if (openCashSessions > 0 || pendingOrders > 0 || activeDispatches > 0) {
        throw new Error(
          `VALIDATION_ERROR: no se puede desactivar la sucursal con caja abierta (${openCashSessions}), ordenes pendientes (${pendingOrders}) o despachos activos (${activeDispatches})`,
        );
      }
    }

    const branchData: Prisma.BranchUpdateInput = {};
    if (typeof input.name === "string") branchData.name = input.name.trim();
    if (typeof input.isActive === "boolean") branchData.isActive = input.isActive;

    if (Object.keys(branchData).length > 0) {
      await tx.branch.update({
        where: { id: branchId },
        data: branchData,
      });
    }

    if (typeof input.enableCashier === "boolean" || typeof input.enableDispatch === "boolean") {
      const previous = await tx.branchModuleConfig.findUnique({ where: { branchId } });
      await tx.branchModuleConfig.upsert({
        where: { branchId },
        update: {
          ...(typeof input.enableCashier === "boolean" ? { enableCashier: input.enableCashier } : {}),
          ...(typeof input.enableDispatch === "boolean" ? { enableDispatch: input.enableDispatch } : {}),
          updatedByUserId: actorUserId,
        },
        create: {
          branchId,
          enableCashier: input.enableCashier ?? true,
          enableDispatch: input.enableDispatch ?? true,
          updatedByUserId: actorUserId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          branchId,
          module: "branches",
          action: "BRANCH_WORKFLOW_CONFIG_UPDATED",
          entityType: "BranchModuleConfig",
          entityId: branchId,
          metadataJson: {
            before: previous ? { enableCashier: previous.enableCashier, enableDispatch: previous.enableDispatch } : null,
            after: { enableCashier: input.enableCashier, enableDispatch: input.enableDispatch },
          },
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId,
        branchId,
        module: "branches",
        action: "BRANCH_UPDATED",
        entityType: "Branch",
        entityId: branchId,
        metadataJson: input,
      },
    });

    return tx.branch.findUniqueOrThrow({
      where: { id: branchId },
      include: branchInclude(),
    });
  });
}
