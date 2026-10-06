/**
 * prompt-alta-productos-qr.md Fase 2 — lógica pura de la pantalla de alta
 * rápida con escáner/lector: qué pantalla mostrar tras consultar by-code,
 * el debounce de "mismo código repetido" (igual que lib/scanner.ts, el
 * lector de cámara — todavía no implementado), y los defaults recordados
 * entre altas de la misma sesión (categoría/unidad/permite fracción).
 */

export type QuickAddProductMatch = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  standardSalePrice: number;
  isActive: boolean;
  category: { id: string; code: string; name: string };
};

export type QuickAddByCodeResponse = {
  product: QuickAddProductMatch | null;
  matchedBy: "barcode" | "sku" | null;
};

export type QuickAddStep =
  | { kind: "FOUND"; product: QuickAddProductMatch; matchedBy: "barcode" | "sku" }
  | { kind: "NOT_FOUND"; code: string }
  | { kind: "ERROR"; code: string; message: string };

/**
 * Decide la pantalla siguiente tras consultar GET /api/catalog/products/by-code.
 * Un código encontrado SIEMPRE muestra la tarjeta "Ya registrado" — nunca
 * abre el formulario de alta (evitaría duplicados).
 */
export function decideQuickAddStep(input: {
  code: string;
  response: QuickAddByCodeResponse | null;
  errorMessage?: string | null;
}): QuickAddStep {
  if (input.errorMessage) {
    return { kind: "ERROR", code: input.code, message: input.errorMessage };
  }
  if (input.response?.product && input.response.matchedBy) {
    return { kind: "FOUND", product: input.response.product, matchedBy: input.response.matchedBy };
  }
  return { kind: "NOT_FOUND", code: input.code };
}

/**
 * Mismo criterio de "ignorar repetido" que lib/scanner.ts: el MISMO código
 * leído/tecleado dos veces dentro de la ventana de debounce se ignora (un
 * doble Enter accidental, o un lector que dispara dos veces) — un código
 * DISTINTO, o el mismo código después de la ventana, nunca se ignora.
 */
export function shouldIgnoreRepeatedCode(
  code: string,
  now: number,
  last: { code: string; at: number } | null,
  debounceMs = 1500,
): boolean {
  if (!last) return false;
  return last.code === code && now - last.at < debounceMs;
}

export type RememberedProductDefaults = {
  categoryId: string;
  unit: string;
  allowsFraction: boolean;
};

/** Mínimo necesario para no tocar APIs del navegador en los tests (localStorage real). */
export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const QUICK_ADD_DEFAULTS_STORAGE_KEY = "hammer:quick-add-product-defaults";

function isRememberedProductDefaults(value: unknown): value is RememberedProductDefaults {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<RememberedProductDefaults>).categoryId === "string" &&
    typeof (value as Partial<RememberedProductDefaults>).unit === "string" &&
    typeof (value as Partial<RememberedProductDefaults>).allowsFraction === "boolean"
  );
}

/**
 * Categoría/unidad/"permite fracción" del último producto guardado en esta
 * sesión de alta — para registrar una caja entera de la misma familia sin
 * repetir. try/catch: localStorage puede fallar (modo privado, cuota,
 * storage deshabilitado) y eso nunca debe romper la pantalla.
 */
export function loadRememberedProductDefaults(storage: KeyValueStorage): RememberedProductDefaults | null {
  try {
    const raw = storage.getItem(QUICK_ADD_DEFAULTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRememberedProductDefaults(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveRememberedProductDefaults(storage: KeyValueStorage, defaults: RememberedProductDefaults): void {
  try {
    storage.setItem(QUICK_ADD_DEFAULTS_STORAGE_KEY, JSON.stringify(defaults));
  } catch {
    // Ver nota de arriba — nunca debe romper el guardado del producto.
  }
}
