import type { RoleCode } from "@prisma/client";
import { CashSessionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CAPABILITIES, getCapabilitiesForRole, type Capability } from "@/modules/rbac/policies";
import { getEffectiveBranchMemberships } from "@/modules/rbac/effective-permissions";

type ModuleFlags = {
  master: boolean;
  pos: boolean;
  cash: boolean;
  warehouse: boolean;
  dispatch: boolean;
  inventory: boolean;
  pricing: boolean;
  purchases: boolean;
  transfers: boolean;
  production: boolean;
  brain: boolean;
  users?: boolean;
  sessionMonitor?: boolean;
};

function uniq(values: string[]) {
  return Array.from(new Set(values));
}

function moduleFlags(capabilities: string[]): ModuleFlags {
  const has = (capability: string) => capabilities.includes(capability);
  return {
    master: has(CAPABILITIES.MASTER_ACCESS) || has(CAPABILITIES.MASTER_DASHBOARD_VIEW),
    pos: has(CAPABILITIES.POS_VIEW) || has(CAPABILITIES.SALES_VIEW),
    cash: has(CAPABILITIES.CASH_VIEW) || has(CAPABILITIES.CASH_PAYMENTS_VIEW),
    warehouse: has(CAPABILITIES.WAREHOUSE_VIEW),
    dispatch: has(CAPABILITIES.DISPATCH_VIEW),
    inventory: has(CAPABILITIES.INVENTORY_VIEW) || has(CAPABILITIES.MASTER_INVENTORY_VIEW) || has(CAPABILITIES.BRANCH_INVENTORY_VIEW),
    pricing: has(CAPABILITIES.PRICING_VIEW) || has(CAPABILITIES.PRICING_EDIT_BRANCH) || has(CAPABILITIES.PRICING_EDIT_GLOBAL),
    purchases: has(CAPABILITIES.PURCHASES_VIEW),
    transfers: has(CAPABILITIES.TRANSFERS_VIEW),
    production: has(CAPABILITIES.PRODUCTION_VIEW) || has(CAPABILITIES.PRODUCTION_DASHBOARD_VIEW),
    brain: has(CAPABILITIES.BRAIN_VIEW),
    users: has(CAPABILITIES.MASTER_USERS_VIEW) || has(CAPABILITIES.MASTER_USERS_MANAGE),
    sessionMonitor: has(CAPABILITIES.MASTER_SESSIONS_VIEW) || has(CAPABILITIES.MASTER_CASH_MONITOR_VIEW),
  };
}

async function granularPermissions(userId: string) {
  const rows = await prisma.userPermission.findMany({
    where: { userId },
    select: { permission: true, granted: true },
  });
  const grants = rows.filter((row) => row.granted).map((row) => row.permission);
  const revokes = new Set(rows.filter((row) => !row.granted).map((row) => row.permission));
  return { grants, revokes };
}

export async function getEffectivePermissionsForUser(input: { userId: string; branchId?: string | null }) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, username: true, globalRole: true, isActive: true, sessionVersion: true },
  });
  if (!user?.isActive) {
    return {
      userId: input.userId,
      globalRole: null,
      branchId: input.branchId ?? null,
      branchRoles: [],
      capabilities: [],
      modules: moduleFlags([]),
      sessionVersion: user?.sessionVersion ?? 0,
    };
  }

  const memberships = await getEffectiveBranchMemberships(input.userId);
  const scopedMemberships = input.branchId
    ? memberships.filter((membership) => membership.branchId === input.branchId)
    : memberships;
  const { grants, revokes } = await granularPermissions(input.userId);

  const globalCaps = user.globalRole ? getCapabilitiesForRole(user.globalRole) : [];
  const branchCaps = scopedMemberships.flatMap((membership) => getCapabilitiesForRole(membership.roleCode));
  const capabilities = uniq([...globalCaps, ...branchCaps, ...grants])
    .filter((capability) => !revokes.has(capability));

  return {
    userId: user.id,
    globalRole: user.globalRole,
    branchId: input.branchId ?? null,
    branchRoles: uniq(scopedMemberships.map((membership) => membership.roleCode)),
    capabilities,
    modules: moduleFlags(capabilities),
    sessionVersion: user.sessionVersion ?? 0,
  };
}

export async function getEnrichedSessionData(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      globalRole: true,
      sessionVersion: true,
      userBranchRoles: {
        where: { isActive: true },
        include: { branch: { select: { id: true, name: true, code: true, isActive: true } } },
      },
    },
  });
  if (!user) return null;

  const branchIds = uniq(user.userBranchRoles.map((membership) => membership.branchId));
  const global = await getEffectivePermissionsForUser({ userId });
  const cashSessions = await prisma.cashSession.findMany({
    where: {
      openedByUserId: userId,
      status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING] },
    },
    include: { physicalCashBox: { include: { branch: { select: { id: true, name: true } } } } },
  });

  const branches = await Promise.all(branchIds.map(async (branchId) => {
    const branchRows = user.userBranchRoles.filter((membership) => membership.branchId === branchId);
    const effective = await getEffectivePermissionsForUser({ userId, branchId });
    const activeCashSession = cashSessions.find((cashSession) => cashSession.physicalCashBox.branchId === branchId);
    const branch = branchRows[0]?.branch;
    return {
      id: branchId,
      name: branch?.name ?? branchId,
      code: branch?.code ?? null,
      roles: effective.branchRoles,
      capabilities: effective.capabilities,
      modules: effective.modules,
      activeCashSession: activeCashSession
        ? {
            id: activeCashSession.id,
            openedAt: activeCashSession.openedAt.toISOString(),
            openingAmount: Number(activeCashSession.openingAmount),
            status: activeCashSession.status,
          }
        : null,
    };
  }));

  return {
    user: {
      id: user.id,
      username: user.username,
      roleCode: user.globalRole ?? branches[0]?.roles[0] ?? null,
    },
    activeBranchId: branches[0]?.id ?? null,
    branches,
    globalCapabilities: global.capabilities,
    modules: global.modules,
    sessionVersion: user.sessionVersion ?? 0,
  };
}
