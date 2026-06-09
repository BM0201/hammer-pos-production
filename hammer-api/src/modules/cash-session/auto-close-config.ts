import { prisma } from "@/lib/prisma";

/**
 * Configurable schedule for the automatic cash-box closing.
 *
 * The configuration is stored as a single JSON value in the generic `SystemSetting`
 * key/value table (key = `cash_auto_close_config`), so MASTER users can change the
 * closing time from the admin UI without a database migration or a redeploy.
 *
 * Times are expressed in 24h "HH:mm" format and interpreted in `timezone`
 * (Nicaragua / America/Managua by default). A `null` time disables auto-close
 * for that day. `enabled = false` disables the whole feature.
 */
export const CASH_AUTO_CLOSE_SETTING_KEY = "cash_auto_close_config";

export interface CashAutoCloseConfig {
  enabled: boolean;
  timezone: string;
  /** Monday–Friday closing time, e.g. "17:30" (5:30 PM). */
  weekdayCloseTime: string | null;
  /** Saturday closing time, e.g. "16:00". */
  saturdayCloseTime: string | null;
  /** Sunday closing time. `null` = no auto-close on Sundays. */
  sundayCloseTime: string | null;
}

export const DEFAULT_CASH_AUTO_CLOSE_CONFIG: CashAutoCloseConfig = {
  enabled: true,
  timezone: "America/Managua",
  weekdayCloseTime: "17:30",
  saturdayCloseTime: "16:00",
  sundayCloseTime: null,
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidTime(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

/**
 * Sanitize a (possibly partial / untrusted) config object into a complete, valid config.
 * Invalid times fall back to the default; explicit `null` is preserved (disables that day).
 * Pure function — safe to unit test.
 */
export function normalizeCashAutoCloseConfig(
  raw: Partial<CashAutoCloseConfig> | null | undefined,
): CashAutoCloseConfig {
  const d = DEFAULT_CASH_AUTO_CLOSE_CONFIG;
  if (!raw || typeof raw !== "object") return { ...d };

  const resolveTime = (value: unknown, fallback: string | null): string | null => {
    if (value === null) return null;
    if (isValidTime(value)) return value;
    return fallback;
  };

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : d.enabled,
    timezone: typeof raw.timezone === "string" && raw.timezone.trim() ? raw.timezone : d.timezone,
    weekdayCloseTime: resolveTime(raw.weekdayCloseTime, d.weekdayCloseTime),
    saturdayCloseTime: resolveTime(raw.saturdayCloseTime, d.saturdayCloseTime),
    sundayCloseTime: resolveTime(raw.sundayCloseTime, d.sundayCloseTime),
  };
}

/** Read the current auto-close config, returning defaults when unset or corrupt. */
export async function getCashAutoCloseConfig(): Promise<CashAutoCloseConfig> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: CASH_AUTO_CLOSE_SETTING_KEY },
  });
  if (!row) return { ...DEFAULT_CASH_AUTO_CLOSE_CONFIG };
  try {
    return normalizeCashAutoCloseConfig(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_CASH_AUTO_CLOSE_CONFIG };
  }
}

/** Persist a new auto-close config (merged over the current one) and return the result. */
export async function updateCashAutoCloseConfig(
  input: Partial<CashAutoCloseConfig>,
  userId?: string,
): Promise<CashAutoCloseConfig> {
  const current = await getCashAutoCloseConfig();
  const merged = normalizeCashAutoCloseConfig({ ...current, ...input });
  const value = JSON.stringify(merged);

  await prisma.systemSetting.upsert({
    where: { key: CASH_AUTO_CLOSE_SETTING_KEY },
    create: { key: CASH_AUTO_CLOSE_SETTING_KEY, value, updatedByUserId: userId ?? null },
    update: { value, updatedByUserId: userId ?? null },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId ?? null,
      module: "cash_session",
      action: "CASH_AUTO_CLOSE_CONFIG_UPDATED",
      entityType: "SystemSetting",
      entityId: CASH_AUTO_CLOSE_SETTING_KEY,
      metadataJson: {
        enabled: merged.enabled,
        timezone: merged.timezone,
        weekdayCloseTime: merged.weekdayCloseTime,
        saturdayCloseTime: merged.saturdayCloseTime,
        sundayCloseTime: merged.sundayCloseTime,
      },
    },
  });

  return merged;
}
