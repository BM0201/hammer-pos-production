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
