/**
 * prompt-caja-gastos-pos-cobro.md Commit 1 — "Una sugerencia por palabras
 * clave solo propone (no elige sola)". Pura, sin DB — mismo principio que
 * expense-kind.ts: se puede testear directo y se llama desde el endpoint
 * de sugerencia (Commit 2 la usa mientras el usuario escribe "¿Qué fue?").
 *
 * "Compra de mercadería o flete" no es una ExpenseCategory real (ver
 * cash-purchase-service.ts) — se devuelve como su propio caso con
 * isPurchase:true para que el llamador sepa que el camino correcto es
 * CashPurchase, no OperatingExpense.
 */
export type ExpenseCategorySuggestion =
  | { isPurchase: false; category: string; matchedKeyword: string }
  | { isPurchase: true; matchedKeyword: string };

type KeywordRule = { keywords: string[] } & ({ isPurchase: true } | { isPurchase: false; category: string });

// El ORDEN importa: se evalúan de arriba hacia abajo y gana la primera que
// coincida. Carga y descarga va ANTES que la regla de compra a propósito —
// "Ignacio descarga de bloques" tiene que ganar como mano de obra, no como
// compra de material, aunque "bloques" también sea palabra clave de compra.
const RULES: KeywordRule[] = [
  { keywords: ["descarga", "ayudante"], isPurchase: false, category: "CASUAL_LABOR" },
  { keywords: ["arena", "bloque", "cemento", "viaje de material"], isPurchase: true },
  { keywords: ["pasaje", "bus", "taxi", "mototaxi"], isPurchase: false, category: "TRANSPORT" },
  { keywords: ["desayuno", "almuerzo", "cena"], isPurchase: false, category: "FOOD" },
  { keywords: ["bolsa", "papel", "cloro"], isPurchase: false, category: "SUPPLIES" },
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Devuelve la primera coincidencia, en el orden de RULES (ver comentario de ahí), o null si ninguna palabra clave aparece. */
export function suggestExpenseCategory(description: string): ExpenseCategorySuggestion | null {
  const text = normalize(description);
  for (const rule of RULES) {
    const matched = rule.keywords.find((k) => text.includes(normalize(k)));
    if (!matched) continue;
    return rule.isPurchase ? { isPurchase: true, matchedKeyword: matched } : { isPurchase: false, category: rule.category, matchedKeyword: matched };
  }
  return null;
}
