/**
 * Copia frontend de hammer-api/src/modules/catalog/presentation-units.ts —
 * misma firma, mismo criterio de normalizacion. No hay paquete compartido
 * entre hammer-api y hammer-frontend en este monorepo, asi que esta logica
 * pura (sin I/O) se replica en vez de importarse. Si cambia una copia,
 * cambia la otra.
 */

/** Normaliza para COMPARAR. No es lo que se guarda ni lo que se muestra. */
export function normalizePresentationUnit(value: string): string {
  return value
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Unidades sugeridas en el asistente. Solo sugerencias — el usuario escribe la que quiera. */
export const COMMON_PRESENTATION_UNITS = [
  "UNIDAD", "LATA", "PALADA", "METRO", "METRO CUBICO", "CAMION", "VIAJE",
  "QUINTAL", "VARILLA", "KILO", "LIBRA", "SACO", "BOLSA", "CAJA", "GALON", "LITRO",
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
