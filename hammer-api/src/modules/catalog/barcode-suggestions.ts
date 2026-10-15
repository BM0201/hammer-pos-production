import { normalizeForDuplicateMatch, diceCoefficient } from "@/modules/catalog/duplicate-finder";

/**
 * prompt-codigos-editar-eliminar.md Fase 2 — "¿podría ser este producto?".
 * Puro, sin DB: barcode-suggestions-service.ts resuelve los datos reales
 * (pool de candidatos, hermanos de marca, contexto de sesión) y esto solo
 * rankea. Pesos en UN SOLO lugar (SUGGESTION_WEIGHTS) para poder ajustarlos
 * con datos reales (ver /suggest/stats) sin ir a buscar números sueltos por
 * el código.
 */

export const SUGGESTION_WEIGHTS = {
  /** Señal 1 — mismo prefijo GS1 que un código ya registrado (≥7 dígitos en común). */
  SAME_MANUFACTURER: 40,
  /** Bonus sobre SAME_MANUFACTURER si además el número de artículo está cerca (±100). */
  ARTICLE_NUMBER_CLOSE: 15,
  /** El candidato se parece, por nombre, a un "hermano" de marca. */
  SIMILAR_NAME_TO_SIBLING: 20,
  /** El candidato es de la misma categoría que algún "hermano" de marca. */
  SAME_CATEGORY_AS_SIBLING: 8,
  /** Señal 2 — el nombre coincide con lo que el usuario ya escribió (`q`). */
  SIMILAR_NAME_TO_QUERY: 35,
  /** Señal 3 — contexto de sesión: misma categoría que los últimos vinculados. */
  SESSION_SAME_CATEGORY: 10,
  /** Señal 3 — además, el nombre se parece al ÚLTIMO vinculado. */
  SESSION_SIMILAR_TO_LAST: 15,
  /** Señal 4 — preferencias. */
  NO_BARCODE: 20,
  ACTIVE_AND_NOT_MERGED: 10,
  HAS_STOCK_IN_BRANCH: 15,
  RECENT_ACTIVITY_60D: 10,
  /** Señal 5 — "otra presentación": mismo producto, otra unidad. Penaliza para no vincular a la presentación equivocada. */
  OTHER_PRESENTATION_PENALTY: -25,
} as const;

/** Mínimo de dígitos en común para considerar "mismo fabricante" — un prefijo corto (3-4 dígitos) es común a medio GS1, no dice nada. */
export const MANUFACTURER_PREFIX_MIN_LENGTH = 7;
/** "Difiere en menos de ±100 en los dígitos de artículo." */
export const ARTICLE_NUMBER_CLOSE_THRESHOLD = 100;
/** Umbral de nombre parecido — mismo que duplicate-finder.ts, reusado para consistencia (no un segundo número inventado). */
const NAME_SIMILARITY_THRESHOLD = 0.5;
const SUGGESTION_LIMIT = 5;

export function longestCommonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

export type ManufacturerSibling = { productId: string; barcodeCode: string; name: string; unit: string; categoryId: string };

/**
 * Señal 1 — códigos FACTORY ya registrados que comparten con `code` un
 * prefijo de al menos MANUFACTURER_PREFIX_MIN_LENGTH dígitos. Ordenado por
 * prefijo más largo primero (el candidato con más dígitos en común es el
 * hermano más cercano).
 */
export function findManufacturerSiblings(code: string, registeredFactoryBarcodes: ManufacturerSibling[]): Array<ManufacturerSibling & { prefixLength: number }> {
  if (!/^\d+$/.test(code)) return [];
  return registeredFactoryBarcodes
    .map((b) => ({ ...b, prefixLength: longestCommonPrefixLength(code, b.barcodeCode) }))
    .filter((b) => /^\d+$/.test(b.barcodeCode) && b.prefixLength >= MANUFACTURER_PREFIX_MIN_LENGTH)
    .sort((a, b) => b.prefixLength - a.prefixLength);
}

/** "Número de artículo cercano" — los dígitos que siguen al prefijo común, sin el verificador final. null si no son puramente numéricos (no comparable). */
export function articleNumberDistance(code: string, siblingCode: string, prefixLength: number): number | null {
  const codeTail = code.slice(prefixLength, code.length - 1);
  const siblingTail = siblingCode.slice(prefixLength, siblingCode.length - 1);
  if (codeTail.length === 0 || siblingTail.length === 0) return null;
  if (!/^\d+$/.test(codeTail) || !/^\d+$/.test(siblingTail)) return null;
  return Math.abs(Number(codeTail) - Number(siblingTail));
}

/** "lat bla gal" encuentra "Látex Blanco Galón" — cada palabra escrita es prefijo de ALGUNA palabra del nombre, en cualquier orden. */
export function wordPrefixMatch(query: string, name: string): boolean {
  const queryTokens = normalizeForDuplicateMatch(query).split(" ").filter(Boolean);
  if (queryTokens.length === 0) return false;
  const nameTokens = normalizeForDuplicateMatch(name).split(" ").filter(Boolean);
  return queryTokens.every((qt) => nameTokens.some((nt) => nt.startsWith(qt)));
}

/** "Otra presentación" — mismo nombre de familia (Dice ≥ umbral) pero distinta unidad: es el mismo producto en otra presentación, no el mismo código. */
export function isOtherPresentation(candidateName: string, candidateUnit: string, referenceName: string, referenceUnit: string): boolean {
  if (candidateUnit === referenceUnit) return false;
  return diceCoefficient(candidateName, referenceName) >= NAME_SIMILARITY_THRESHOLD;
}

export type SuggestionReason = { code: string; text: string };

export type SuggestionCandidate = {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  categoryId: string;
  hasBarcode: boolean;
  isActive: boolean;
  isMerged: boolean;
  stockInBranch: number;
  recentActivity60d: boolean;
};

export type RecentSessionProduct = { productId: string; name: string; categoryId: string; unit: string };

export type RankSuggestionsInput = {
  code: string;
  query?: string;
  manufacturerSiblings: ManufacturerSibling[];
  /** Últimos vinculados en la sesión — el [0] es el MÁS RECIENTE. */
  recentSessionProducts: RecentSessionProduct[];
  candidates: SuggestionCandidate[];
};

export type RankedSuggestion = { productId: string; score: number; reasons: SuggestionReason[] };

/**
 * El ranking completo: por cada candidato, suma las señales que apliquen y
 * junta sus razones (en español, con código para poder testear sin parsear
 * texto). Devuelve los mejores 5, score descendente.
 */
export function rankBarcodeSuggestions(input: RankSuggestionsInput): RankedSuggestion[] {
  const siblings = findManufacturerSiblings(input.code, input.manufacturerSiblings);
  const bestSibling = siblings[0] ?? null;
  const lastSession = input.recentSessionProducts[0] ?? null;

  const ranked = input.candidates.map((candidate) => {
    let score = 0;
    const reasons: SuggestionReason[] = [];

    // Señal 1 — mismo fabricante.
    if (siblings.length > 0) {
      const matchingSibling = siblings.find((s) => diceCoefficient(candidate.name, s.name) >= NAME_SIMILARITY_THRESHOLD || candidate.categoryId === s.categoryId);
      if (matchingSibling) {
        if (diceCoefficient(candidate.name, matchingSibling.name) >= NAME_SIMILARITY_THRESHOLD) {
          score += SUGGESTION_WEIGHTS.SAME_MANUFACTURER + SUGGESTION_WEIGHTS.SIMILAR_NAME_TO_SIBLING;
          reasons.push({ code: "SAME_MANUFACTURER", text: `Mismo fabricante: ${siblings.length} producto${siblings.length === 1 ? "" : "s"} con códigos ${matchingSibling.barcodeCode.slice(0, MANUFACTURER_PREFIX_MIN_LENGTH)}…` });
        } else {
          score += SUGGESTION_WEIGHTS.SAME_MANUFACTURER + SUGGESTION_WEIGHTS.SAME_CATEGORY_AS_SIBLING;
          reasons.push({ code: "SAME_MANUFACTURER", text: `Mismo fabricante: ${siblings.length} producto${siblings.length === 1 ? "" : "s"} con códigos ${matchingSibling.barcodeCode.slice(0, MANUFACTURER_PREFIX_MIN_LENGTH)}…` });
        }
        const distance = articleNumberDistance(input.code, matchingSibling.barcodeCode, matchingSibling.prefixLength);
        if (distance !== null && distance < ARTICLE_NUMBER_CLOSE_THRESHOLD) {
          score += SUGGESTION_WEIGHTS.ARTICLE_NUMBER_CLOSE;
        }
      }
    }

    // Señal 2 — nombre parecido a lo escrito.
    if (input.query && wordPrefixMatch(input.query, candidate.name)) {
      score += SUGGESTION_WEIGHTS.SIMILAR_NAME_TO_QUERY;
      reasons.push({ code: "SIMILAR_NAME", text: "Nombre parecido" });
    }

    // Señal 3 — contexto de sesión (anaquel).
    if (lastSession) {
      if (candidate.categoryId === lastSession.categoryId) {
        score += SUGGESTION_WEIGHTS.SESSION_SAME_CATEGORY;
        reasons.push({ code: "SESSION_CONTEXT", text: "Misma categoría que el anterior" });
      }
      if (diceCoefficient(candidate.name, lastSession.name) >= NAME_SIMILARITY_THRESHOLD) {
        score += SUGGESTION_WEIGHTS.SESSION_SIMILAR_TO_LAST;
      }
    }

    // Señal 4 — preferencias.
    if (!candidate.hasBarcode) {
      score += SUGGESTION_WEIGHTS.NO_BARCODE;
      reasons.push({ code: "NO_BARCODE", text: "Sin código" });
    }
    if (candidate.isActive && !candidate.isMerged) score += SUGGESTION_WEIGHTS.ACTIVE_AND_NOT_MERGED;
    if (candidate.stockInBranch > 0) score += SUGGESTION_WEIGHTS.HAS_STOCK_IN_BRANCH;
    if (candidate.recentActivity60d) score += SUGGESTION_WEIGHTS.RECENT_ACTIVITY_60D;

    // Señal 5 — otra presentación (mismo hermano de marca, o el último vinculado en la sesión, con otra unidad).
    const presentationReference = bestSibling ?? lastSession;
    if (presentationReference && isOtherPresentation(candidate.name, candidate.unit, presentationReference.name, presentationReference.unit)) {
      score += SUGGESTION_WEIGHTS.OTHER_PRESENTATION_PENALTY;
      reasons.push({ code: "OTHER_PRESENTATION", text: `Otra presentación (${candidate.unit})` });
    }

    return { productId: candidate.productId, score, reasons };
  });

  return ranked
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SUGGESTION_LIMIT);
}
