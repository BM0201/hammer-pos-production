import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Día Operativo v2 Fase 3 — tolerancia de diferencia de caja configurable por
 * sucursal (mata el número mágico `Math.abs(cashDifferenceTotal) > 100`
 * hardcodeado en dos lugares de operations/service.ts). Mismo mecanismo que
 * ya usa el módulo para configuración (SystemSetting con clave fija + JSON +
 * caché TTL + auditoría) — ver auto-day-config.ts / approve-policy-config.ts.
 */

export const CASH_TOLERANCE_SETTING_KEY = "operational_day_cash_tolerance_config";

export interface CashToleranceConfig {
  /** Tolerancia por defecto (C$) para sucursales sin override. */
  defaultToleranceAmount: number;
  /** Overrides por sucursal: branchId -> tolerancia en C$. */
  byBranch: Record<string, number>;
}

export const DEFAULT_CASH_TOLERANCE_CONFIG: CashToleranceConfig = {
  defaultToleranceAmount: 100,
  byBranch: {},
};

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function normalizeCashToleranceConfig(
  raw: Partial<CashToleranceConfig> | null | undefined,
): CashToleranceConfig {
  const d = DEFAULT_CASH_TOLERANCE_CONFIG;
  if (!raw || typeof raw !== "object") return { ...d, byBranch: {} };

  const byBranch: Record<string, number> = {};
  if (raw.byBranch && typeof raw.byBranch === "object") {
    for (const [branchId, value] of Object.entries(raw.byBranch)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        byBranch[branchId] = value;
      }
    }
  }

  return {
    defaultToleranceAmount: num(raw.defaultToleranceAmount, d.defaultToleranceAmount),
    byBranch,
  };
}

/** Resuelve la tolerancia (C$) de una sucursal: override si existe, si no el default global. */
export function resolveCashToleranceForBranch(config: CashToleranceConfig, branchId: string): number {
  return config.byBranch[branchId] ?? config.defaultToleranceAmount;
}

// TTL cache (mismo patrón que auto-day-config.ts): se lee en cada cierre/checklist,
// cambia solo por acción admin rara.
const CONFIG_CACHE_TTL_MS = 60_000;
let configCache: { value: CashToleranceConfig; expiresAt: number } | null = null;

export async function getCashToleranceConfig(): Promise<CashToleranceConfig> {
  if (configCache && configCache.expiresAt > Date.now()) return { ...configCache.value, byBranch: { ...configCache.value.byBranch } };

  const row = await prisma.systemSetting.findUnique({ where: { key: CASH_TOLERANCE_SETTING_KEY } });
  let config: CashToleranceConfig;
  if (!row) {
    config = { ...DEFAULT_CASH_TOLERANCE_CONFIG, byBranch: {} };
  } else {
    try {
      config = normalizeCashToleranceConfig(JSON.parse(row.value));
    } catch {
      config = { ...DEFAULT_CASH_TOLERANCE_CONFIG, byBranch: {} };
    }
  }
  configCache = { value: config, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
  return { ...config, byBranch: { ...config.byBranch } };
}

export async function updateCashToleranceConfig(
  input: Partial<CashToleranceConfig>,
  userId?: string,
): Promise<CashToleranceConfig> {
  const current = await getCashToleranceConfig();
  const merged = normalizeCashToleranceConfig({
    defaultToleranceAmount: input.defaultToleranceAmount ?? current.defaultToleranceAmount,
    byBranch: { ...current.byBranch, ...(input.byBranch ?? {}) },
  });
  const value = JSON.stringify(merged);

  await prisma.systemSetting.upsert({
    where: { key: CASH_TOLERANCE_SETTING_KEY },
    create: { key: CASH_TOLERANCE_SETTING_KEY, value, updatedByUserId: userId ?? null },
    update: { value, updatedByUserId: userId ?? null },
  });
  configCache = { value: merged, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };

  await prisma.auditLog.create({
    data: {
      actorUserId: userId ?? null,
      module: "operations",
      action: "OPERATIONAL_DAY_CASH_TOLERANCE_CONFIG_UPDATED",
      entityType: "SystemSetting",
      entityId: CASH_TOLERANCE_SETTING_KEY,
      metadataJson: merged as unknown as Prisma.InputJsonValue,
    },
  });

  return merged;
}
