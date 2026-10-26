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

/**
 * Abreviaturas que usaba el alta de producto viejo \u2192 la palabra que usa el
 * resto del cat\u00e1logo. "UN" y "UNIDAD" son la misma unidad: tratarlas como
 * distintas dejaba pasar dos presentaciones "iguales" en una fusi\u00f3n y
 * part\u00eda el cat\u00e1logo en dos vocabularios.
 */
export const LEGACY_UNIT_ALIASES: Record<string, string> = {
  UN: "UNIDAD", UND: "UNIDAD", U: "UNIDAD",
  KG: "KILO", LB: "LIBRA", L: "LITRO", LT: "LITRO", GAL: "GALON",
  M: "METRO", M2: "METRO CUADRADO", M3: "METRO CUBICO", QQ: "QUINTAL",
};

/** Normaliza para COMPARAR. No es lo que se guarda ni lo que se muestra. */
export function normalizePresentationUnit(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  return LEGACY_UNIT_ALIASES[normalized] ?? normalized;
}

/** Normaliza para GUARDAR: mismo criterio, y es la forma canónica en DB. */
export function canonicalizePresentationUnit(value: string): string {
  return normalizePresentationUnit(value);
}

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
