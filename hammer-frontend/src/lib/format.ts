/**
 * Utilidades de formateo reutilizables — moneda, cantidades, fechas.
 * Centraliza lógica duplicada en múltiples componentes.
 */

const moneyFormatter = new Intl.NumberFormat("es-NI", {
  style: "currency",
  currency: "NIO",
  maximumFractionDigits: 2,
});

const qtyFormatter = new Intl.NumberFormat("es-NI", {
  maximumFractionDigits: 4,
});

/** Formatea un valor numérico como moneda nicaragüense (C$). */
export function money(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  return moneyFormatter.format(Number.isFinite(num) ? num : 0);
}

/** Formatea una cantidad numérica con hasta 4 decimales. */
export function qty(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  return qtyFormatter.format(Number.isFinite(num) ? num : 0);
}

/** Formatea una fecha ISO a string legible en español-NI. */
export function fmtDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString("es-NI", { year: "numeric", month: "short", day: "numeric" });
}

/** Formatea una fecha ISO a string con hora. */
export function fmtDateTime(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleString("es-NI");
}

/** Fecha + hora compacta ("15/3/26, 2:30 p. m.") — duplicada en ~6 archivos
 * (brain, sales, cameras, security, users/activity) antes de esta función. */
export function fmtDateTimeShort(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleString("es-NI", { dateStyle: "short", timeStyle: "short" });
}

/** Fecha + hora con mes en letras ("15 mar 2026, 2:30 p. m.") — duplicada
 * en 3 archivos (brain/decision-center, decision-detail-drawer, account/mfa)
 * antes de esta función. */
export function fmtDateTimeMedium(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleString("es-NI", { dateStyle: "medium", timeStyle: "short" });
}

/** Fecha + hora numérica ("15/03/2026, 02:30") — duplicada en
 * master/audit/print-logs y master/history antes de esta función. */
export function fmtDateTimeNumeric(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleString("es-NI", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Fecha con día de la semana ("lunes, 15 mar") — duplicada en
 * cash-indicator-panel y cash-accumulation-bar antes de esta función. */
export function fmtWeekdayDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString("es-NI", { weekday: "long", day: "2-digit", month: "short" });
}

/**
 * money() sin decimales, redondeado con Math.round (no vía Intl) — para
 * etiquetas compactas donde 2 decimales sobran (ej. barra de composición
 * de nómina). Se usa Math.round explícito en vez de maximumFractionDigits:0
 * porque no se puede garantizar el mismo modo de redondeo en el borde .5
 * entre Math.round (siempre hacia arriba) y el redondeo que use Intl según
 * el motor — moverla acá es un relocate literal de fmtC0, sin ese riesgo.
 */
export function moneyRounded(value: number): string {
  return `C$${Math.round(value).toLocaleString("es-NI")}`;
}

/**
 * money() sin decimales, vía Intl directo (maximumFractionDigits: 0) — NO
 * intercambiable con moneyRounded(): difieren en negativos (Math.round(-0.5)
 * = -0 → "C$-0"; Intl redondea -0.5 lejos de cero → "-C$1"). Usada en
 * dashboards de reportes de ventas (siempre valores ≥ 0 en la práctica, pero
 * se mantiene separada de moneyRounded por si alguna vez no lo son).
 */
const money0Formatter = new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO", maximumFractionDigits: 0 });
export function money0(value: number): string {
  return money0Formatter.format(value);
}

/**
 * Cantidad con N decimales EXACTOS (rellena con ceros) — a diferencia de
 * qty(), que recorta ceros de sobra (maximumFractionDigits sin minimum).
 * decimals=2 por default. Usada donde varios campos comparten un mismo
 * formateador con distinto N (ej. pies, costo por pie, gastos de viaje).
 */
export function numFixed(value: number | string | null | undefined, decimals = 2): string {
  const num = value === null || value === undefined ? 0 : typeof value === "number" ? value : Number(value);
  return num.toLocaleString("es-NI", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Cantidad con hasta 2 decimales, sin símbolo (recorta ceros de sobra,
 * como qty() pero con 2 en vez de 4) — usada para cantidades de
 * paquete/suelto en fusión de inventario.
 */
export function qty2(value: number): string {
  return value.toLocaleString("es-NI", { maximumFractionDigits: 2 });
}
