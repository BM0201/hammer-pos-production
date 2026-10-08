/**
 * prompt-carga-precios.md Fase 4 — extraído de catalog-inventory/import-service.ts
 * (ahí vivía inline, duplicado en espíritu con lo que la importación de
 * precios necesitaba hacer igual: normalizar encabezados y elegir la
 * primera columna que matchee una lista de alias). Mecanismo genérico; las
 * listas de alias siguen siendo propias de cada importador.
 */

/** Sin tildes, minúscula, sin espacios ni símbolos — "Código Interno" y "codigo_interno" matchean igual. */
export function normalizeHeader(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function buildHeaderIndex(headerRow: string[]): Map<string, number> {
  return new Map(headerRow.map(normalizeHeader).map((header, idx) => [header, idx]));
}

/** Primera columna de `aliases` que aparece en el encabezado indexado; "" si ninguna matcheó. */
export function pickByAlias(cells: string[], index: Map<string, number>, aliases: string[]): string {
  const idx = aliases.map((name) => index.get(name)).find((value) => value !== undefined);
  return idx === undefined ? "" : cells[idx]?.trim() ?? "";
}
