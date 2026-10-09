/**
 * prompt-codigos-y-duplicados.md Fase 5 — Enter en el buscador del POS.
 * Pura, sin red ni estado — mismo principio que decideScanStep
 * (quick-add-product.ts): esta función decide QUÉ hacer, el componente
 * resuelve los datos (fetch a by-code si hace falta) y ejecuta la acción.
 *
 * El bug de fondo: Enter agregaba SIEMPRE products[activeIndex] ?? products[0]
 * — el primer resultado de la búsqueda difusa, sin importar si lo que se
 * tecleó/escaneó coincidía EXACTO con ese producto o con ninguno. Un código
 * escaneado que no estaba en los primeros resultados (o que la lista
 * todavía no había terminado de cargar, por el debounce de 250ms) agregaba
 * el producto equivocado en silencio.
 */

export type PosEnterProduct = {
  id: string;
  sku: string;
  barcode?: string | null;
  barcodes?: string[];
};

export type PosEnterAction<T extends PosEnterProduct> =
  | { kind: "ADD_EXACT"; product: T }
  | { kind: "QUERY_BY_CODE"; code: string }
  | { kind: "ADD_FUZZY_FIRST"; product: T }
  | { kind: "WAIT" };

/**
 * Un código escaneado o un SKU nunca tiene espacios — toda búsqueda de
 * texto real en este catálogo (nombres de producto en español) sí los
 * tiene ("Cemento Canal", "Clavo 2 pulgadas"). Patrones reales de este
 * catálogo: puramente numérico (EAN/UPC), SKU (prefijo de letras + guion +
 * dígitos, ej. "GEN-0001"), o el interno "HMR-<sku>".
 */
export function looksLikeScannedCode(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /^\d+$/.test(trimmed) || /^[A-Za-z]{2,8}-[A-Za-z0-9-]+$/.test(trimmed) || /^HMR-/i.test(trimmed);
}

/** Coincidencia EXACTA contra barcode principal, un código secundario, o el SKU — nunca difusa. */
export function findExactProductMatch<T extends PosEnterProduct>(code: string, products: T[]): T | null {
  const normalized = code.trim();
  if (!normalized) return null;
  return (
    products.find(
      (p) =>
        p.barcode === normalized ||
        p.sku.toUpperCase() === normalized.toUpperCase() ||
        (p.barcodes ?? []).includes(normalized),
    ) ?? null
  );
}

export function resolvePosEnter<T extends PosEnterProduct>(input: {
  /** El texto tal como está en el campo de búsqueda al presionar Enter. */
  typedText: string;
  /** Los productos actualmente renderizados (resultado de la última búsqueda aplicada). */
  visibleProducts: T[];
  activeIndex: number;
  /**
   * true si `visibleProducts` todavía corresponde a una búsqueda ANTERIOR
   * (el debounce de 250ms no alcanzó a traer los resultados de `typedText`
   * — típico de un escaneo, que escribe y presiona Enter casi instantáneo).
   * El caller lo calcula comparando `typedText` contra la búsqueda que de
   * verdad produjo `visibleProducts` (ver use-pos-catalog.ts: appliedQuery).
   */
  isListStale: boolean;
}): PosEnterAction<T> {
  const typed = input.typedText.trim();
  if (!typed) return { kind: "WAIT" };

  // La coincidencia EXACTA gana siempre, esté o no esté seleccionada en la
  // lista — es la respuesta correcta sin importar qué tan "difusa" quedó
  // rankeada la búsqueda de texto.
  const exact = findExactProductMatch(typed, input.visibleProducts);
  if (exact) return { kind: "ADD_EXACT", product: exact };

  // Parece un código pero no está en lo visible ahora mismo — puede ser que
  // la lista todavía esté vieja, o que el producto exista pero no haya
  // quedado entre los primeros resultados de texto. En los dos casos la
  // respuesta correcta es preguntarle al servidor por ESE código exacto,
  // nunca agregar el primero de una lista que no lo contiene.
  if (looksLikeScannedCode(typed)) {
    return { kind: "QUERY_BY_CODE", code: typed };
  }

  // Búsqueda de texto genuina (tiene espacio, o no matchea ningún patrón de
  // código) con la lista todavía desactualizada — esperar al debounce en
  // vez de agregar lo que quedó de la búsqueda anterior.
  if (input.isListStale) return { kind: "WAIT" };

  const fallback = input.visibleProducts[input.activeIndex] ?? input.visibleProducts[0];
  return fallback ? { kind: "ADD_FUZZY_FIRST", product: fallback } : { kind: "WAIT" };
}
