/**
 * prompt-alta-productos-qr.md Fase 2 — lógica pura de la pantalla de alta
 * rápida con escáner/lector: qué pantalla mostrar tras consultar by-code,
 * y los defaults recordados entre altas de la misma sesión (categoría/
 * unidad/permite fracción). El debounce de "mismo código repetido" ahora
 * vive en lib/scanner.ts (lo comparte con el lector de cámara) — se
 * re-exporta acá para no romper los imports existentes.
 */
export { shouldIgnoreRepeatedCode } from "@/lib/scanner";

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

/**
 * prompt-codigos-editar-eliminar.md Fase 3.2 — "No mantener dos flujos de
 * etiquetado": el modo "Etiquetar catálogo" (código no encontrado → buscar
 * en el catálogo existente y vincularlo) se reemplaza por un enlace a la
 * pantalla nueva "Códigos de barra" (modo Escanear, con sugerencias
 * "¿podría ser este producto?"). Esta pantalla vuelve a tener un solo
 * propósito: Registrar nuevos.
 */
export type ScanStep =
  | { kind: "FOUND"; product: QuickAddProductMatch; matchedBy: "barcode" | "sku" }
  | { kind: "ERROR"; code: string; message: string }
  | { kind: "REGISTER_NOT_FOUND"; code: string };

/**
 * Decide la pantalla siguiente tras consultar GET /api/catalog/products/by-code.
 * Un código encontrado SIEMPRE muestra la tarjeta "Ya registrado" — nunca
 * abre el formulario de alta (evitaría duplicados). Sin coincidencia, abre
 * el formulario de alta.
 */
export function decideScanStep(input: {
  code: string;
  response: QuickAddByCodeResponse | null;
  errorMessage?: string | null;
}): ScanStep {
  if (input.errorMessage) {
    return { kind: "ERROR", code: input.code, message: input.errorMessage };
  }
  if (input.response?.product && input.response.matchedBy) {
    return { kind: "FOUND", product: input.response.product, matchedBy: input.response.matchedBy };
  }
  return { kind: "REGISTER_NOT_FOUND", code: input.code };
}

/**
 * "¿Este producto ya está en el catálogo?" — antes de crear un producto
 * nuevo en modo Registrar, se compara el nombre tecleado contra el
 * catálogo existente (resultados de una búsqueda por nombre ya traídos por
 * el caller — esta función NO pega a la red). Coincidencia exacta
 * (normalizada) primero; si no hay, una coincidencia parcial donde uno de
 * los dos nombres contiene literalmente al otro (ej. "Cemento Canal" vs
 * "Cemento Canal 42.5kg") — nunca un fuzzy-match real, mismo criterio que
 * findProductByCode en el backend: ante la duda, no asumir.
 */
export type NameSimilarityCandidate = { id: string; name: string; sku: string };

const COMBINING_DIACRITICAL_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

export function normalizeProductName(name: string): string {
  return name
    .normalize("NFD")
    .replace(COMBINING_DIACRITICAL_MARKS, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function findSimilarProductByName(
  typedName: string,
  candidates: NameSimilarityCandidate[],
): NameSimilarityCandidate | null {
  const typed = normalizeProductName(typedName);
  if (typed.length < 3) return null;

  const exact = candidates.find((c) => normalizeProductName(c.name) === typed);
  if (exact) return exact;

  const partial = candidates.find((c) => {
    const candidateName = normalizeProductName(c.name);
    return candidateName.includes(typed) || typed.includes(candidateName);
  });
  return partial ?? null;
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
