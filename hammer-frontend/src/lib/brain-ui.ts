/**
 * prompt-brain-centro-decisiones.md Fase 3.8 — "ningún texto de dominio en
 * el frontend": etiqueta de tipo, área, CTA y evidencia vienen del backend
 * (decision-catalog.ts). Acá solo queda la copia de PANTALLA (títulos,
 * botones genéricos) y la lógica pura de la UI (estado de salud, "desde
 * hace", qué botones mostrar, armado de URL) — las piezas que Fase 3 pide
 * probar con test:unit:logic.
 */

export type HealthLevel = "ok" | "partial" | "stale" | "never";
export type HealthLineStatus = { level: HealthLevel; message: string };

const STALE_HOURS = 2;
const OPERATING_HOUR_START = 6;
const OPERATING_HOUR_END = 22;

function managuaHour(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Managua", hour: "2-digit", hour12: false }).format(date));
}

/** "en horario de operación" — mismo rango que el cron (6:35–21:35 Managua), redondeado a la hora para esta comparación. */
export function isWithinOperatingHours(now: Date): boolean {
  const hour = managuaHour(now);
  return hour >= OPERATING_HOUR_START && hour < OPERATING_HOUR_END;
}

export function healthLineStatus(input: {
  lastRunFinishedAt: Date | null;
  lastRunStatus: "OK" | "PARTIAL" | "FAILED" | null;
  failedDetectorKey?: string | null;
  now: Date;
}): HealthLineStatus {
  if (!input.lastRunFinishedAt) {
    return { level: "never", message: "Brain todavía no revisó el sistema." };
  }

  const hoursSinceLastRun = (input.now.getTime() - input.lastRunFinishedAt.getTime()) / (60 * 60 * 1000);
  if (hoursSinceLastRun > STALE_HOURS && isWithinOperatingHours(input.now)) {
    return { level: "stale", message: `Sin escaneo en más de ${STALE_HOURS} horas.` };
  }

  if (input.lastRunStatus === "PARTIAL") {
    return {
      level: "partial",
      message: input.failedDetectorKey ? `Último escaneo parcial: ${input.failedDetectorKey} falló.` : "Último escaneo parcial.",
    };
  }

  if (input.lastRunStatus === "FAILED") {
    return { level: "stale", message: "El último escaneo falló por completo." };
  }

  return { level: "ok", message: "Al día." };
}

/** "desde hace" — minutos, horas, días o meses, lo que corresponda; nunca segundos exactos (ruido). */
export function formatTimeAgo(date: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return "hace un momento";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "hace 1 día";
  if (days < 30) return `hace ${days} días`;

  const months = Math.floor(days / 30);
  if (months <= 1) return "hace 1 mes";
  return `hace ${months} meses`;
}

export type DecisionResolution = "IN_MODULE" | "EXECUTABLE" | "ACKNOWLEDGE";
export type DecisionAction = "GO_RESOLVE" | "RESOLVE" | "RUN" | "ACKNOWLEDGE" | "SNOOZE" | "DISMISS" | "REOPEN";

const TERMINAL_WITH_REOPEN = new Set(["RESOLVED", "DISMISSED", "EXPIRED", "SNOOZED"]);
const TERMINAL_WITHOUT_ACTIONS = new Set(["EXECUTED", "EXECUTING"]);

/**
 * Fase 3.4 — qué botones mostrar en una fila, según su `resolution`
 * (IN_MODULE/EXECUTABLE/ACKNOWLEDGE, del catálogo) y su `status` actual.
 * Un estado cerrado (RESOLVED/DISMISSED/EXPIRED/SNOOZED) solo ofrece
 * reabrir; EXECUTED/EXECUTING no ofrecen nada (ya se resolvió, o está en
 * curso); todo lo demás (OPEN/APPROVED/MANUAL_REVIEW/FAILED) es "activo" y
 * ofrece sus acciones según resolution.
 */
export function actionsForDecision(input: { resolution: DecisionResolution; status: string }): DecisionAction[] {
  if (TERMINAL_WITH_REOPEN.has(input.status)) return ["REOPEN"];
  if (TERMINAL_WITHOUT_ACTIONS.has(input.status)) return [];

  if (input.resolution === "IN_MODULE") return ["GO_RESOLVE", "RESOLVE", "SNOOZE", "DISMISS"];
  if (input.resolution === "EXECUTABLE") return ["RUN", "SNOOZE", "DISMISS"];
  return ["ACKNOWLEDGE", "SNOOZE", "DISMISS"];
}

export type InboxUrlFilters = { branchId?: string; area?: string; status?: string; q?: string };

/** Fase 3.3/3.4 — filtros de área/estado/búsqueda en la URL (compartibles, soportan "atrás"). PENDING es el default — no ensucia la URL si no cambió. */
export function buildInboxUrl(base: string, filters: InboxUrlFilters): string {
  const params = new URLSearchParams();
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.area) params.set("area", filters.area);
  if (filters.status && filters.status !== "PENDING") params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export const AREA_LABELS: Record<string, string> = {
  PRICING: "Precios",
  CASH: "Caja",
  SALES: "Ventas",
  INVENTORY: "Inventario",
  REORDER: "Reposición",
  PURCHASING: "Compras",
  DISPATCH: "Despacho",
  PRODUCTION: "Producción",
  SECURITY: "Seguridad",
  SYSTEM: "Sistema",
};

export const STATUS_TAB_LABELS = {
  PENDING: "Pendientes",
  SNOOZED: "Pospuestas",
  RESOLVED: "Resueltas",
  DISMISSED: "No aplica",
} as const;

export const ACTION_LABELS: Record<DecisionAction, string> = {
  GO_RESOLVE: "Ir a resolver",
  RESOLVE: "Ya lo resolví",
  RUN: "Ejecutar",
  ACKNOWLEDGE: "Ya lo revisé",
  SNOOZE: "Posponer",
  DISMISS: "No aplica",
  REOPEN: "Reabrir",
};
