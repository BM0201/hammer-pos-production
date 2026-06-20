import { CashSessionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/types/auth";

const IDLE_AFTER_MS = 2 * 60 * 1000;
const OFFLINE_AFTER_MS = 10 * 60 * 1000;

type PresenceInput = {
  session: SessionPayload;
  branchId?: string | null;
  currentPath?: string | null;
  currentModule?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export function resolvePresenceStatus(input: { lastSeenAt?: Date | null; disconnectedAt?: Date | null }, now = new Date()) {
  if (!input.lastSeenAt || input.disconnectedAt) return "OFFLINE";
  const elapsedMs = now.getTime() - input.lastSeenAt.getTime();
  if (elapsedMs > OFFLINE_AFTER_MS) return "OFFLINE";
  if (elapsedMs > IDLE_AFTER_MS) return "IDLE";
  return "ONLINE";
}

// Heartbeat writes are throttled: skip the upsert when the last presence
// record is fresh enough, saving one DB write per heartbeat interval.
const PRESENCE_WRITE_THROTTLE_MS = 30_000;

export async function markUserOnline(input: PresenceInput) {
  const now = new Date();

  const existing = await prisma.userPresence.findUnique({
    where: { userId: input.session.userId },
    select: { lastSeenAt: true, disconnectedAt: true },
  });

  const isFresh = existing?.lastSeenAt
    && !existing.disconnectedAt
    && now.getTime() - existing.lastSeenAt.getTime() < PRESENCE_WRITE_THROTTLE_MS;

  if (isFresh) return;

  return prisma.userPresence.upsert({
    where: { userId: input.session.userId },
    create: {
      userId: input.session.userId,
      sessionId: `${input.session.userId}:${input.session.sessionVersion ?? 0}`,
      branchId: input.branchId ?? input.session.primaryBranchId ?? null,
      username: input.session.username,
      roleCode: input.session.roleCode,
      status: "ONLINE",
      currentPath: input.currentPath ?? null,
      currentModule: input.currentModule ?? null,
      lastSeenAt: now,
      connectedAt: now,
      disconnectedAt: null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
    update: {
      sessionId: `${input.session.userId}:${input.session.sessionVersion ?? 0}`,
      branchId: input.branchId ?? input.session.primaryBranchId ?? undefined,
      username: input.session.username,
      roleCode: input.session.roleCode,
      status: "ONLINE",
      currentPath: input.currentPath ?? undefined,
      currentModule: input.currentModule ?? undefined,
      lastSeenAt: now,
      disconnectedAt: null,
      ipAddress: input.ipAddress ?? undefined,
      userAgent: input.userAgent ?? undefined,
    },
  });
}

export async function markUserOffline(userId: string) {
  const now = new Date();
  await prisma.userPresence.updateMany({
    where: { userId },
    data: { status: "OFFLINE", disconnectedAt: now, lastSeenAt: now },
  });
}

export async function getUserActivitySnapshot() {
  const [users, cashSessions] = await Promise.all([
    prisma.user.findMany({
      where: { NOT: { username: { startsWith: "deleted-" } } },
      select: {
        id: true,
        username: true,
        globalRole: true,
        isActive: true,
        userBranchRoles: {
          where: { isActive: true },
          select: { branchId: true, roleCode: true, branch: { select: { id: true, name: true, code: true } } },
        },
        presences: {
          select: {
            branchId: true,
            status: true,
            currentPath: true,
            currentModule: true,
            lastSeenAt: true,
            connectedAt: true,
            disconnectedAt: true,
            branch: { select: { id: true, name: true, code: true } },
          },
        },
      },
      orderBy: [{ username: "asc" }],
    }),
    prisma.cashSession.findMany({
      where: { status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING] } },
      include: {
        openedBy: { select: { id: true, username: true } },
        physicalCashBox: { include: { branch: { select: { id: true, name: true, code: true } } } },
      },
      orderBy: { openedAt: "desc" },
    }),
  ]);

  const now = new Date();
  const cashByUser = new Map<string, typeof cashSessions>();
  for (const cashSession of cashSessions) {
    const rows = cashByUser.get(cashSession.openedByUserId) ?? [];
    rows.push(cashSession);
    cashByUser.set(cashSession.openedByUserId, rows);
  }

  const connectedUsers = users.map((user) => {
    const presence = user.presences[0] ?? null;
    const status = user.isActive
      ? resolvePresenceStatus({ lastSeenAt: presence?.lastSeenAt, disconnectedAt: presence?.disconnectedAt }, now)
      : "OFFLINE";
    const activeCashSessions = (cashByUser.get(user.id) ?? []).map((cashSession) => ({
      id: cashSession.id,
      status: cashSession.status,
      openedAt: cashSession.openedAt.toISOString(),
      openingAmount: Number(cashSession.openingAmount),
      physicalCashBoxId: cashSession.physicalCashBoxId,
      physicalCashBoxName: cashSession.physicalCashBox.description ?? cashSession.physicalCashBox.code,
      branchId: cashSession.physicalCashBox.branchId,
      branchName: cashSession.physicalCashBox.branch.name,
      branchCode: cashSession.physicalCashBox.branch.code,
    }));
    const activeRoleCodes = new Set(user.userBranchRoles.map((membership) => membership.roleCode));

    return {
      userId: user.id,
      username: user.username,
      globalRole: user.globalRole,
      isActive: user.isActive,
      status,
      currentPath: presence?.currentPath ?? null,
      currentModule: presence?.currentModule ?? null,
      branch: presence?.branch
        ? { id: presence.branch.id, name: presence.branch.name, code: presence.branch.code }
        : null,
      lastSeenAt: presence?.lastSeenAt?.toISOString() ?? null,
      connectedAt: presence?.connectedAt?.toISOString() ?? null,
      disconnectedAt: presence?.disconnectedAt?.toISOString() ?? null,
      branchRoles: user.userBranchRoles.map((membership) => ({
        branchId: membership.branchId,
        branchName: membership.branch.name,
        branchCode: membership.branch.code,
        roleCode: membership.roleCode,
      })),
      activeCashSessions,
      cashAccessWarning: activeCashSessions.length > 0 && !activeRoleCodes.has("CASHIER") && user.globalRole !== "MASTER" && user.globalRole !== "OWNER" && user.globalRole !== "SYSTEM_ADMIN",
    };
  });

  return {
    generatedAt: now.toISOString(),
    summary: {
      online: connectedUsers.filter((user) => user.status === "ONLINE").length,
      idle: connectedUsers.filter((user) => user.status === "IDLE").length,
      offline: connectedUsers.filter((user) => user.status === "OFFLINE").length,
      openCashSessions: cashSessions.length,
    },
    users: connectedUsers,
  };
}
