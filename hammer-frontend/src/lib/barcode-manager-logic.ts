/**
 * Fase 3 (prompt-codigos-editar-eliminar.md) — lógica pura de la ficha
 * "Códigos" y de la pantalla nueva "Códigos de barra": todo lo que se puede
 * probar sin DOM vive acá (test:unit:logic); los componentes solo arman la
 * UI alrededor.
 */

export type BarcodeKind = "FACTORY" | "INTERNAL" | "SUPPLIER";
export type BarcodeIssue = "CHECKSUM_INVALID" | "PRODUCT_INACTIVE" | "PRODUCT_MERGED" | "MULTIPLE_CODES" | "INTERNAL_SKU_MISMATCH" | "NO_PRIMARY";

// ── Edición en línea (3.1) ──────────────────────────────────────────────

export type BarcodeEditDraft = { code: string; kind: BarcodeKind };

/** "Guardar" deshabilitado si el código queda vacío o si nada cambió. */
export function canSaveBarcodeEdit(original: BarcodeEditDraft, draft: BarcodeEditDraft): boolean {
  const trimmed = draft.code.trim();
  if (!trimmed) return false;
  return trimmed !== original.code || draft.kind !== original.kind;
}

// ── Modal de quitar (3.1) ────────────────────────────────────────────────

/** Texto del modal de quitar — qué aviso mostrar según si es principal, interno, o ninguno de los dos. */
export function removeBarcodeWarningLines(input: { isPrimary: boolean; kind: BarcodeKind; nextPrimaryCode: string | null }): string[] {
  const lines = ["Si este código está impreso o pegado en el producto, el escáner ya no va a encontrar el producto."];
  if (input.isPrimary) {
    lines.push(input.nextPrimaryCode ? `El principal pasa a ser ${input.nextPrimaryCode}.` : "El producto queda sin código.");
  }
  if (input.kind === "INTERNAL") {
    lines.push("Las etiquetas impresas con este código dejan de servir.");
  }
  return lines;
}

/** "Deshacer" visible por 10 segundos tras quitar. */
export const UNDO_WINDOW_MS = 10_000;
export function isUndoStillAvailable(removedAtMs: number, nowMs: number): boolean {
  return nowMs - removedAtMs < UNDO_WINDOW_MS;
}

// ── Interpretación del 409 (3.1) ─────────────────────────────────────────

export type BarcodeConflict = { id: string; name: string; sku: string; barcode: string; isActive?: boolean };

/** Extrae el BARCODE_ALREADY_EXISTS (si lo hay) del cuerpo crudo de una respuesta de error — null para cualquier otra cosa. */
export function parseBarcodeConflict(errorBody: unknown): BarcodeConflict | null {
  if (!errorBody || typeof errorBody !== "object") return null;
  const err = (errorBody as { error?: { code?: string; details?: unknown } }).error;
  if (!err || err.code !== "BARCODE_ALREADY_EXISTS" || !err.details || typeof err.details !== "object") return null;
  const details = err.details as Partial<BarcodeConflict>;
  if (typeof details.id !== "string" || typeof details.name !== "string" || typeof details.sku !== "string" || typeof details.barcode !== "string") return null;
  return { id: details.id, name: details.name, sku: details.sku, barcode: details.barcode, isActive: details.isActive };
}

// ── Filtros de "problema" (3.1/3.2) ──────────────────────────────────────

export function countByIssue(rows: Array<{ issues: BarcodeIssue[] }>): Record<BarcodeIssue, number> {
  const counts: Record<BarcodeIssue, number> = { CHECKSUM_INVALID: 0, PRODUCT_INACTIVE: 0, PRODUCT_MERGED: 0, MULTIPLE_CODES: 0, INTERNAL_SKU_MISMATCH: 0, NO_PRIMARY: 0 };
  for (const row of rows) for (const issue of row.issues) counts[issue] += 1;
  return counts;
}

// ── Atajo de dígito contra escaneo del lector (3.2) ──────────────────────

/**
 * "Un dígito cuenta como atajo SOLO si llega solo, con el campo vacío, y no
 * le sigue otra tecla en 120ms. Si llegan varios caracteres rápido (menos
 * de 50ms entre teclas), es un escaneo." — el umbral de 120ms YA cubre el
 * de 50ms (un lector real escribe mucho más rápido que eso): si una
 * segunda tecla llegó dentro de la ventana de confirmación, sea cual sea
 * su velocidad, ya no es "un solo dígito solo" y se trata como el inicio
 * de un código escaneado. `keystrokes` es TODO lo que llegó dentro de esa
 * ventana de 120ms desde la primera tecla (el caller la arma con un
 * temporizador; esta función solo decide con lo que ya se juntó).
 */
export const SHORTCUT_CONFIRM_DELAY_MS = 120;

export type DigitShortcutClassification = "SHORTCUT" | "NOT_SHORTCUT";

export function classifyKeystrokeBurst(input: { keystrokes: Array<{ key: string; timestampMs: number }>; fieldWasEmptyAtStart: boolean }): DigitShortcutClassification {
  if (!input.fieldWasEmptyAtStart) return "NOT_SHORTCUT";
  if (input.keystrokes.length !== 1) return "NOT_SHORTCUT";
  const key = input.keystrokes[0].key;
  return /^[1-5n]$/i.test(key) ? "SHORTCUT" : "NOT_SHORTCUT";
}

// ── Modo "Recorrer por categoría" (3.2) ──────────────────────────────────

export type CategoryWalkProduct = { productId: string; name: string; sku: string; stockInBranch: number };
export type CategoryWalkState = { products: CategoryWalkProduct[]; currentIndex: number; doneProductIds: string[] };

/** Stock primero — lo que más rota es lo que más conviene etiquetar antes. */
export function initCategoryWalk(products: CategoryWalkProduct[]): CategoryWalkState {
  return { products: [...products].sort((a, b) => b.stockInBranch - a.stockInBranch), currentIndex: 0, doneProductIds: [] };
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

export function currentCategoryWalkProduct(state: CategoryWalkState): CategoryWalkProduct | null {
  return state.products[state.currentIndex] ?? null;
}

/** "Saltar" (↓) — avanza sin marcar hecho el actual. */
export function skipCategoryWalk(state: CategoryWalkState): CategoryWalkState {
  return { ...state, currentIndex: clampIndex(state.currentIndex + 1, state.products.length) };
}

/** "Volver" (↑). */
export function retreatCategoryWalk(state: CategoryWalkState): CategoryWalkState {
  return { ...state, currentIndex: clampIndex(state.currentIndex - 1, state.products.length) };
}

/** Escanear el código asignado al resaltado: lo marca hecho y pasa al siguiente. */
export function assignCategoryWalkCode(state: CategoryWalkState): CategoryWalkState {
  const current = currentCategoryWalkProduct(state);
  if (!current) return state;
  const doneProductIds = state.doneProductIds.includes(current.productId) ? state.doneProductIds : [...state.doneProductIds, current.productId];
  return { ...state, doneProductIds, currentIndex: clampIndex(state.currentIndex + 1, state.products.length) };
}

export function categoryWalkProgress(state: CategoryWalkState): { done: number; total: number } {
  return { done: state.doneProductIds.length, total: state.products.length };
}

/**
 * "Si el código escaneado tiene un prefijo de otra marca que la del
 * resaltado, confirmar." Reusa las sugerencias que YA calculó el backend
 * (GET /suggest?code=...) en vez de reimplementar la comparación de
 * fabricante en el cliente: si hay señal de fabricante (SAME_MANUFACTURER)
 * y el resaltado no es parte de ella, es sospechoso; sin ninguna señal de
 * fabricante, no hay base para dudar (podría ser una marca nunca vista).
 */
export type SuggestionLike = { productId: string; reasons: Array<{ code: string }> };

export function categoryWalkBrandMismatchWarning(highlightedProductId: string, highlightedProductName: string, suggestions: SuggestionLike[]): string | null {
  const hasManufacturerSignal = suggestions.some((s) => s.reasons.some((r) => r.code === "SAME_MANUFACTURER"));
  if (!hasManufacturerSignal) return null;
  const highlightedMatches = suggestions.some((s) => s.productId === highlightedProductId && s.reasons.some((r) => r.code === "SAME_MANUFACTURER"));
  if (highlightedMatches) return null;
  return `Este código parece de otra marca; ¿seguro que es de ${highlightedProductName}?`;
}
