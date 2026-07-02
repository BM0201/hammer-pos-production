import { prisma } from "@/lib/prisma";

export const OPERATIONAL_DAY_AUTO_SETTING_KEY = "operational_day_auto_config";

export interface OperationalDayAutoConfig {
  autoOpenEnabled: boolean;
  autoCloseEnabled: boolean;
  timezone: string;
  weekdayOpenTime: string | null;
  saturdayOpenTime: string | null;
  sundayOpenTime: string | null;
  weekdayCloseTime: string | null;
  saturdayCloseTime: string | null;
  sundayCloseTime: string | null;
}

export const DEFAULT_OPERATIONAL_DAY_AUTO_CONFIG: OperationalDayAutoConfig = {
  autoOpenEnabled: false,
  autoCloseEnabled: false,
  timezone: "America/Managua",
  weekdayOpenTime: "07:00",
  saturdayOpenTime: "07:00",
  sundayOpenTime: null,
  weekdayCloseTime: "18:30",
  saturdayCloseTime: "17:00",
  sundayCloseTime: null,
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidTime(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

export function normalizeOperationalDayAutoConfig(
  raw: Partial<OperationalDayAutoConfig> | null | undefined,
): OperationalDayAutoConfig {
  const d = DEFAULT_OPERATIONAL_DAY_AUTO_CONFIG;
  if (!raw || typeof raw !== "object") return { ...d };

  const resolveTime = (value: unknown, fallback: string | null): string | null => {
    if (value === null) return null;
    if (isValidTime(value)) return value;
    return fallback;
  };

  return {
    autoOpenEnabled: typeof raw.autoOpenEnabled === "boolean" ? raw.autoOpenEnabled : d.autoOpenEnabled,
    autoCloseEnabled: typeof raw.autoCloseEnabled === "boolean" ? raw.autoCloseEnabled : d.autoCloseEnabled,
    timezone: typeof raw.timezone === "string" && raw.timezone.trim() ? raw.timezone : d.timezone,
    weekdayOpenTime: resolveTime(raw.weekdayOpenTime, d.weekdayOpenTime),
    saturdayOpenTime: resolveTime(raw.saturdayOpenTime, d.saturdayOpenTime),
    sundayOpenTime: resolveTime(raw.sundayOpenTime, d.sundayOpenTime),
    weekdayCloseTime: resolveTime(raw.weekdayCloseTime, d.weekdayCloseTime),
    saturdayCloseTime: resolveTime(raw.saturdayCloseTime, d.saturdayCloseTime),
    sundayCloseTime: resolveTime(raw.sundayCloseTime, d.sundayCloseTime),
  };
}

// TTL cache: this config is read on every cron tick (every 10 min, plus twice
// per operational-automation run) but changes only via rare admin actions.
// 60s TTL on warm serverless instances avoids re-hitting Neon per call; the
// update function below invalidates the local cache immediately. Cross-instance
// staleness is bounded to 60s, which is harmless for open/close schedules.
const CONFIG_CACHE_TTL_MS = 60_000;
let configCache: { value: OperationalDayAutoConfig; expiresAt: number } | null = null;

export async function getOperationalDayAutoConfig(): Promise<OperationalDayAutoConfig> {
  if (configCache && configCache.expiresAt > Date.now()) return { ...configCache.value };

  const row = await prisma.systemSetting.findUnique({
    where: { key: OPERATIONAL_DAY_AUTO_SETTING_KEY },
  });
  let config: OperationalDayAutoConfig;
  if (!row) {
    config = { ...DEFAULT_OPERATIONAL_DAY_AUTO_CONFIG };
  } else {
    try {
      config = normalizeOperationalDayAutoConfig(JSON.parse(row.value));
    } catch {
      config = { ...DEFAULT_OPERATIONAL_DAY_AUTO_CONFIG };
    }
  }
  configCache = { value: config, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
  return { ...config };
}

export async function updateOperationalDayAutoConfig(
  input: Partial<OperationalDayAutoConfig>,
  userId?: string,
): Promise<OperationalDayAutoConfig> {
  const current = await getOperationalDayAutoConfig();
  const merged = normalizeOperationalDayAutoConfig({ ...current, ...input });
  const value = JSON.stringify(merged);

  await prisma.systemSetting.upsert({
    where: { key: OPERATIONAL_DAY_AUTO_SETTING_KEY },
    create: { key: OPERATIONAL_DAY_AUTO_SETTING_KEY, value, updatedByUserId: userId ?? null },
    update: { value, updatedByUserId: userId ?? null },
  });
  configCache = { value: merged, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };

  await prisma.auditLog.create({
    data: {
      actorUserId: userId ?? null,
      module: "operations",
      action: "OPERATIONAL_DAY_AUTO_CONFIG_UPDATED",
      entityType: "SystemSetting",
      entityId: OPERATIONAL_DAY_AUTO_SETTING_KEY,
      metadataJson: merged as unknown as import("@prisma/client").Prisma.InputJsonValue,
    },
  });

  return merged;
}
