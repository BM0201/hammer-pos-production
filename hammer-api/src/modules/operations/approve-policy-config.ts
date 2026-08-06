import { Prisma } from "@prisma/client";
import type { SessionPayload } from "@/types/auth";
import { prisma } from "@/lib/prisma";
import { assertBranchAccess } from "@/modules/auth/access";

export const OPERATIONAL_DAY_APPROVE_SETTING_KEY = "operational_day_approve_config";

export interface OperationalDayApprovalPolicy {
  branchAdminApprovalEnabled: boolean;
  maxCashDifferenceForDelegate: number; // C$, default 100
  blockDelegateOnForcedClose: boolean; // default true
  maxSalesTotalForDelegate: number | null; // null = sin tope
}

export const DEFAULT_APPROVAL_POLICY: OperationalDayApprovalPolicy = {
  branchAdminApprovalEnabled: false,
  maxCashDifferenceForDelegate: 100,
  blockDelegateOnForcedClose: true,
  maxSalesTotalForDelegate: null,
};

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNum(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeApprovalPolicy(
  raw: Partial<OperationalDayApprovalPolicy> | null | undefined,
): OperationalDayApprovalPolicy {
  const d = DEFAULT_APPROVAL_POLICY;
  if (!raw || typeof raw !== "object") return { ...d };
  return {
    branchAdminApprovalEnabled: bool(raw.branchAdminApprovalEnabled, d.branchAdminApprovalEnabled),
    maxCashDifferenceForDelegate: Math.max(0, num(raw.maxCashDifferenceForDelegate, d.maxCashDifferenceForDelegate)),
    blockDelegateOnForcedClose: bool(raw.blockDelegateOnForcedClose, d.blockDelegateOnForcedClose),
    maxSalesTotalForDelegate: nullableNum(raw.maxSalesTotalForDelegate, d.maxSalesTotalForDelegate),
  };
}

export async function getApprovalPolicy(): Promise<OperationalDayApprovalPolicy> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: OPERATIONAL_DAY_APPROVE_SETTING_KEY },
  });
  if (!row) return { ...DEFAULT_APPROVAL_POLICY };
  try {
    return normalizeApprovalPolicy(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_APPROVAL_POLICY };
  }
}

export async function updateApprovalPolicy(
  input: Partial<OperationalDayApprovalPolicy>,
  userId?: string,
): Promise<OperationalDayApprovalPolicy> {
  const current = await getApprovalPolicy();
  const merged = normalizeApprovalPolicy({ ...current, ...input });
  const value = JSON.stringify(merged);

  await prisma.systemSetting.upsert({
    where: { key: OPERATIONAL_DAY_APPROVE_SETTING_KEY },
    create: { key: OPERATIONAL_DAY_APPROVE_SETTING_KEY, value, updatedByUserId: userId ?? null },
    update: { value, updatedByUserId: userId ?? null },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId ?? null,
      module: "operations",
      action: "OPERATIONAL_DAY_APPROVE_CONFIG_UPDATED",
      entityType: "SystemSetting",
      entityId: OPERATIONAL_DAY_APPROVE_SETTING_KEY,
      metadataJson: merged as unknown as Prisma.InputJsonValue,
    },
  });

  return merged;
}

function n(value: Prisma.Decimal | number | string | null | undefined): number {
  return Number(value ?? 0);
}

function isMasterSession(session: SessionPayload): boolean {
  const roles = session.globalRoles as unknown as string[];
  return roles.includes("MASTER") || roles.includes("OWNER") || roles.includes("SYSTEM_ADMIN");
}

function isBranchAdminSession(session: SessionPayload): boolean {
  return session.branchMemberships.some((m) => (m.roleCode as unknown as string) === "BRANCH_ADMIN");
}

/**
 * Determines whether the given session may approve the supplied operational day,
 * honouring the delegation policy. MASTER (and above) always may. A BRANCH_ADMIN
 * may approve only when delegation is enabled and the day stays within the
 * configured guardrails (cash difference, sales total, and force-close rule).
 *
 * `forceApprove` remains MASTER-exclusive and is enforced separately in the route.
 */
export function assertCanApproveOperationalDay(
  session: SessionPayload,
  day: {
    branchId: string;
    cashDifferenceTotal: Prisma.Decimal | number | null;
    salesTotal?: Prisma.Decimal | number | null;
    checklistJson?: Prisma.JsonValue;
  },
  policy: OperationalDayApprovalPolicy,
): void {
  if (isMasterSession(session)) return;

  if (isBranchAdminSession(session)) {
    if (!policy.branchAdminApprovalEnabled) throw new Error("OPERATIONAL_DAY_APPROVAL_REQUIRES_MASTER");

    // Must have access to the branch the day belongs to.
    assertBranchAccess(session, day.branchId);

    if (Math.abs(n(day.cashDifferenceTotal)) > policy.maxCashDifferenceForDelegate) {
      throw new Error("OPERATIONAL_DAY_APPROVAL_REQUIRES_MASTER");
    }

    if (policy.blockDelegateOnForcedClose && hadAttentionItems(day.checklistJson)) {
      throw new Error("OPERATIONAL_DAY_APPROVAL_REQUIRES_MASTER");
    }

    if (policy.maxSalesTotalForDelegate !== null && n(day.salesTotal) > policy.maxSalesTotalForDelegate) {
      throw new Error("OPERATIONAL_DAY_APPROVAL_REQUIRES_MASTER");
    }

    return;
  }

  throw new Error("OPERATIONAL_DAY_APPROVAL_REQUIRES_MASTER");
}

/**
 * Detecta si el checklist informativo (day-summary.ts::buildChecklist) tenía
 * algún ítem en ATTENTION al momento de confirmar — un delegado (BRANCH_ADMIN)
 * no debería poder confirmar un día que necesitaba justificación de Master.
 */
function hadAttentionItems(checklistJson?: Prisma.JsonValue): boolean {
  if (!checklistJson || typeof checklistJson !== "object" || Array.isArray(checklistJson)) {
    return false;
  }
  const checklist = checklistJson as Record<string, unknown>;
  const attention = checklist.attention;
  return Array.isArray(attention) && attention.length > 0;
}
