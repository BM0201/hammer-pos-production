/**
 * prompt-gastos-semana-quincena.md Fase 3 — mapa de colores FIJO por
 * categoría de gasto, con variante clara/oscura, para que la gráfica de
 * barras apiladas y las leyendas de "Gastos por período" se vean igual de
 * legibles en ambos temas (a diferencia de CATEGORY_COLORS en
 * expense-manager.types.ts, que es un solo hex sin variante oscura).
 *
 * UNCLASSIFIED ("Sin clasificar") es siempre ámbar — es la categoría que
 * pide atención, no una categoría de negocio más.
 */
export type FinanceCategoryColor = { light: string; dark: string };

export const FINANCE_CATEGORY_COLORS: Record<string, FinanceCategoryColor> = {
  PAYROLL: { light: "#6366f1", dark: "#818cf8" },
  UTILITIES: { light: "#f59e0b", dark: "#fbbf24" },
  RENT: { light: "#ef4444", dark: "#f87171" },
  FOOD: { light: "#22c55e", dark: "#4ade80" },
  MAINTENANCE: { light: "#8b5cf6", dark: "#a78bfa" },
  TRANSPORT: { light: "#3b82f6", dark: "#60a5fa" },
  MARKETING: { light: "#ec4899", dark: "#f472b6" },
  TAXES: { light: "#db2777", dark: "#f0599f" },
  OTHER: { light: "#6b7280", dark: "#9ca3af" },
  UNCLASSIFIED: { light: "#d97706", dark: "#f59e0b" },
};

const FALLBACK_COLOR: FinanceCategoryColor = { light: "#6b7280", dark: "#9ca3af" };

/** Color de una categoría para el tema dado — nunca undefined, cae a gris neutro si la categoría no está en el mapa. */
export function getCategoryColor(category: string, theme: "light" | "dark"): string {
  const entry = FINANCE_CATEGORY_COLORS[category] ?? FALLBACK_COLOR;
  return theme === "dark" ? entry.dark : entry.light;
}

/**
 * Ordena categorías para tablas/leyendas: "Sin clasificar" siempre al final
 * (pide atención aparte, no compite por posición con el gasto real), el
 * resto por el criterio que pase el caller (ya ordenado antes de llamar
 * esto — esta función solo reubica UNCLASSIFIED).
 */
export function withUnclassifiedLast<T extends { category: string }>(rows: T[]): T[] {
  const classified = rows.filter((r) => r.category !== "UNCLASSIFIED");
  const unclassified = rows.filter((r) => r.category === "UNCLASSIFIED");
  return [...classified, ...unclassified];
}
