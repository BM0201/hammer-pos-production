import type { OperationalDayAutoConfig } from "@/modules/operations/auto-day-config";

/**
 * Helpers puros para leer el horario de referencia (Ajustes) contra "ahora".
 * Puramente informativo — Día Operativo 360: ningún horario abre ni cierra
 * nada. Ver auto-day-config.ts para la persistencia del horario.
 */
const DEFAULT_TIMEZONE = "America/Managua";

type LocalParts = { weekday: string; hour: number; minute: number };

export function localParts(now: Date, timezone = DEFAULT_TIMEZONE): LocalParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const byType = new Map(parts.map((p) => [p.type, p.value]));
  return {
    weekday: (byType.get("weekday") ?? "Sunday").toLowerCase(),
    hour: Number(byType.get("hour") ?? 0),
    minute: Number(byType.get("minute") ?? 0),
  };
}

export function resolveTimeForDay(
  weekday: string,
  config: Pick<OperationalDayAutoConfig, "weekdayOpenTime" | "saturdayOpenTime" | "sundayOpenTime">,
): string | null;
export function resolveTimeForDay(
  weekday: string,
  config: Pick<OperationalDayAutoConfig, "weekdayCloseTime" | "saturdayCloseTime" | "sundayCloseTime">,
): string | null;
export function resolveTimeForDay(weekday: string, config: Record<string, string | null>): string | null {
  if (weekday === "saturday") return config["saturdayOpenTime"] ?? config["saturdayCloseTime"] ?? null;
  if (weekday === "sunday") return config["sundayOpenTime"] ?? config["sundayCloseTime"] ?? null;
  return config["weekdayOpenTime"] ?? config["weekdayCloseTime"] ?? null;
}
