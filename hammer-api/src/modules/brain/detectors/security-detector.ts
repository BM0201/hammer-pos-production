import { prisma } from "@/lib/prisma";
import { riskScoreFor } from "@/modules/brain/scoring";
import type { BrainDecisionDraft, BrainDetectorContext } from "@/modules/brain/types";

const privilegedRoles = new Set(["SYSTEM_ADMIN", "OWNER", "MASTER"]);

export async function detectSecurityDecisions(ctx: BrainDetectorContext): Promise<BrainDecisionDraft[]> {
  const decisions: BrainDecisionDraft[] = [];

  const [activeUsers, sensitiveAudits] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      include: { userBranchRoles: { where: { isActive: true }, select: { id: true, branchId: true, roleCode: true } } },
      take: 500,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.auditLog.findMany({
      where: {
        occurredAt: { gte: ctx.since },
        action: { in: ["PRODUCT_UPDATED", "INVENTORY_ADJUSTED", "USER_UPDATED", "CASH_SESSION_DENIED"] },
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
      },
      select: { actorUserId: true, action: true, branchId: true },
      take: 1000,
    }),
  ]);

  for (const user of activeUsers) {
    if (!user.globalRole && user.userBranchRoles.length === 0) {
      decisions.push({
        category: "SECURITY",
        severity: "HIGH",
        title: `Usuario activo sin membresia efectiva: ${user.username}`,
        description: `${user.fullName} esta activo, pero no tiene rol global ni membresia activa.`,
        recommendation: "Asignar membresia valida o desactivar el usuario para evitar estados inconsistentes.",
        targetUserId: user.id,
        confidenceScore: 96,
        riskScore: riskScoreFor("HIGH", 96),
        proposedActionType: "REVIEW_USER_PERMISSIONS",
        evidenceJson: { username: user.username, globalRole: user.globalRole, activeMemberships: user.userBranchRoles.length },
        sourceJson: { detector: "security-detector" },
        fingerprintParts: ["security", "active-user-no-membership", user.id],
      });
    }

    if (user.globalRole && privilegedRoles.has(user.globalRole)) {
      decisions.push({
        category: "SECURITY",
        severity: "INFO",
        title: `Rol global sensible: ${user.username}`,
        description: `${user.fullName} tiene rol global ${user.globalRole}.`,
        recommendation: "Confirmar periodicamente que el acceso privilegiado sigue justificado.",
        targetUserId: user.id,
        confidenceScore: 90,
        riskScore: riskScoreFor("INFO", 90),
        proposedActionType: "REVIEW_USER_PERMISSIONS",
        evidenceJson: { username: user.username, globalRole: user.globalRole },
        sourceJson: { detector: "security-detector" },
        fingerprintParts: ["security", "privileged-role-review", user.id, user.globalRole],
      });
    }
  }

  const byActor = new Map<string, { actorUserId: string; count: number; actions: Record<string, number>; branchId?: string | null }>();
  for (const audit of sensitiveAudits) {
    if (!audit.actorUserId) continue;
    const row = byActor.get(audit.actorUserId) ?? { actorUserId: audit.actorUserId, count: 0, actions: {}, branchId: audit.branchId };
    row.count++;
    row.actions[audit.action] = (row.actions[audit.action] ?? 0) + 1;
    byActor.set(audit.actorUserId, row);
  }

  for (const row of byActor.values()) {
    if (row.count < 10) continue;
    decisions.push({
      category: "AUDIT",
      severity: row.count >= 25 ? "HIGH" : "MEDIUM",
      title: "Actividad sensible frecuente por usuario",
      description: `Un usuario acumula ${row.count} acciones sensibles en ${ctx.days} dias.`,
      recommendation: "Revisar permisos, cambios realizados y si corresponde abrir caso de auditoria.",
      branchId: row.branchId ?? undefined,
      targetUserId: row.actorUserId,
      confidenceScore: 76,
      riskScore: riskScoreFor(row.count >= 25 ? "HIGH" : "MEDIUM", 76),
      proposedActionType: "CREATE_AUDIT_CASE",
      evidenceJson: { count: row.count, actions: row.actions },
      sourceJson: { detector: "security-detector" },
      fingerprintParts: ["audit", "sensitive-activity-by-user", row.actorUserId, ctx.days],
    });
  }

  return decisions;
}
