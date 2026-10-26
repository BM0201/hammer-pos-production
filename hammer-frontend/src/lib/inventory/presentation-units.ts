/**
 * Copia frontend de hammer-api/src/modules/catalog/presentation-units.ts —
 * misma firma, mismo criterio de normalizacion. No hay paquete compartido
 * entre hammer-api y hammer-frontend en este monorepo, asi que esta logica
 * pura (sin I/O) se replica en vez de importarse. Si cambia una copia,
 * cambia la otra.
 */

/** Abreviaturas viejas → palabra del catálogo (misma tabla que el backend). */
export const LEGACY_UNIT_ALIASES: Record<string, string> = {
  UN: "UNIDAD", UND: "UNIDAD", U: "UNIDAD",
  KG: "KILO", LB: "LIBRA", L: "LITRO", LT: "LITRO", GAL: "GALON",
  M: "METRO", M2: "METRO CUADRADO", M3: "METRO CUBICO", QQ: "QUINTAL",
};

/** Normaliza para COMPARAR. No es lo que se guarda ni lo que se muestra. */
export function normalizePresentationUnit(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  return LEGACY_UNIT_ALIASES[normalized] ?? normalized;
}

/**
 * LA lista de unidades del catálogo — alta de producto, alta rápida, edición
 * y fusiones sugieren las mismas (antes el alta usaba UN/KG/L/M y las
 * fusiones UNIDAD/KILO/LITRO/METRO, y QUINTAL no existía al crear). Sin
 * tildes: es la forma en que se guardan (normalizePresentationUnit). Solo
 * sugerencias — el usuario puede escribir otra.
 */
export const COMMON_PRESENTATION_UNITS = [
  "UNIDAD", "QUINTAL", "VARILLA", "METRO", "METRO CUADRADO", "METRO CUBICO",
  "LITRO", "GALON", "CUBETA", "KILO", "LIBRA", "BOLSA", "SACO", "LATA", "PALADA",
  "CAJA", "PAQUETE", "ROLLO", "PLIEGO", "PAR", "JUEGO", "CAMION", "VIAJE",
] as const;

export type UnitCollision = {
  unit: string;
  productIds: string[];
};

/**
 * Devuelve las unidades de venta repetidas entre los miembros. Pura y sin I/O
 * — mismo criterio que el backend, para que el asistente pueda validar antes
 * de mandar la petición y el servidor la rechace igual si algo se coló.
 */
export function findUnitCollisions(
  members: Array<{ productId: string; saleUnit: string }>,
): UnitCollision[] {
  const byUnit = new Map<string, string[]>();
  for (const member of members) {
    const unit = normalizePresentationUnit(member.saleUnit ?? "");
    byUnit.set(unit, [...(byUnit.get(unit) ?? []), member.productId]);
  }
  return [...byUnit.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([unit, productIds]) => ({ unit, productIds }));
}

/**
 * Factores idénticos entre DOS derivados distintos. Advertencia, nunca
 * bloqueo — ver la contraparte backend para el razonamiento completo.
 */
export function findDuplicateFactors(
  members: Array<{ productId: string; conversionFactor: number; isCanonical: boolean }>,
): Array<{ factor: number; productIds: string[] }> {
  const byFactor = new Map<number, string[]>();
  for (const member of members) {
    if (member.isCanonical) continue;
    const factor = Number(member.conversionFactor);
    byFactor.set(factor, [...(byFactor.get(factor) ?? []), member.productId]);
  }
  return [...byFactor.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([factor, productIds]) => ({ factor, productIds }));
}
