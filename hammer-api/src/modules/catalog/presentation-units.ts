/**
 * Fuente única de verdad sobre las unidades de venta de una fusión.
 *
 * Existe porque la unidad de venta era, hasta ahora, un campo que se copiaba
 * de `Product.unit` sin validación ni edición posible. Cuando los productos
 * de una familia comparten `unit` (caso real: los cuatro productos de piedrín
 * creados con unit="UNIDAD", con la unidad real escrita en el NOMBRE), la
 * fusión entera quedaba ciega: baseUnit="UNIDAD", los tres miembros
 * saleUnit="UNIDAD", y lo único que distinguía una presentación de otra era
 * un número sin etiqueta.
 */

/** Normaliza para COMPARAR. No es lo que se guarda ni lo que se muestra. */
export function normalizePresentationUnit(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Normaliza para GUARDAR: mismo criterio, y es la forma canónica en DB. */
export function canonicalizePresentationUnit(value: string): string {
  return normalizePresentationUnit(value);
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
 * para que la use tanto la validación de escritura como el verificador de
 * salud, sin que puedan divergir.
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
 * Factores idénticos entre DOS derivados distintos. No es imposible en
 * teoría, pero en la práctica es siempre un error de carga (el caso real:
 * "metro de 100 paladas" y "metro de 220 paladas" ambos con factor 5).
 * Se reporta como advertencia, nunca como bloqueo.
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
