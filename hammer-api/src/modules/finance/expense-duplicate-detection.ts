/**
 * prompt-caja-gastos-pos-cobro.md Commit 1 — "Aviso de posible duplicado":
 * misma sucursal, mismo monto ±1 %, en las últimas 24 h, y descripción
 * parecida O misma categoría. Pura, sin DB — la función de servicio
 * (findPossibleDuplicateExpense, pricing/service.ts) le pasa candidatos ya
 * leídos de OperatingExpense, esta función solo decide. No bloquea: el
 * caller la usa para armar un aviso que el frontend muestra y el backend
 * acepta igual si llega `confirmedNotDuplicate: true`.
 */
export type ExpenseDuplicateCandidate = {
  id: string;
  category: string;
  description: string;
  amount: number;
  createdAt: Date;
};

export type NewExpenseInput = {
  category: string;
  description: string;
  amount: number;
  /** Momento del nuevo gasto — normalmente "ahora", parametrizado para poder testear. */
  now: Date;
};

const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const AMOUNT_TOLERANCE_PCT = 0.01;

function normalizeWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3),
  );
}

/** Jaccard sobre palabras de 3+ letras — "parecida" sin exigir texto idéntico. */
function descriptionSimilarity(a: string, b: string): number {
  const wordsA = normalizeWords(a);
  const wordsB = normalizeWords(b);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection += 1;
  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

const SIMILARITY_THRESHOLD = 0.3;

function amountWithinTolerance(a: number, b: number): boolean {
  if (a === 0 && b === 0) return true;
  const base = Math.max(Math.abs(a), Math.abs(b));
  if (base === 0) return true;
  return Math.abs(a - b) / base <= AMOUNT_TOLERANCE_PCT;
}

/** El candidato más probable de ser el mismo gasto repetido — null si ninguno de los candidatos coincide. */
export function findPossibleDuplicate(
  input: NewExpenseInput,
  candidates: readonly ExpenseDuplicateCandidate[],
): ExpenseDuplicateCandidate | null {
  for (const candidate of candidates) {
    const ageMs = input.now.getTime() - candidate.createdAt.getTime();
    if (ageMs < 0 || ageMs > DUPLICATE_WINDOW_MS) continue;
    if (!amountWithinTolerance(input.amount, candidate.amount)) continue;
    const sameCategory = candidate.category === input.category;
    const similarDescription = descriptionSimilarity(input.description, candidate.description) >= SIMILARITY_THRESHOLD;
    if (sameCategory || similarDescription) return candidate;
  }
  return null;
}
