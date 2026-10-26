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
export const UNIT_GROUPS: ReadonlyArray<{ label: string; units: readonly string[] }> = [
  { label: "Conteo", units: ["UNIDAD", "PAR", "JUEGO", "PAQUETE", "CAJA"] },
  { label: "Peso", units: ["QUINTAL", "KILO", "LIBRA"] },
  { label: "Largo", units: ["METRO", "VARILLA", "ROLLO", "PLIEGO"] },
  { label: "Área y volumen", units: ["METRO CUADRADO", "METRO CUBICO", "LATA", "PALADA", "CUBETA"] },
  { label: "Líquidos", units: ["LITRO", "GALON"] },
  { label: "Empaque", units: ["BOLSA", "SACO"] },
  { label: "Acarreo", units: ["CAMION", "VIAJE"] },
];

/** Cómo se MUESTRA una unidad guardada sin tilde (GALON → GALÓN). */
const UNIT_DISPLAY: Record<string, string> = { GALON: "GALÓN", "METRO CUBICO": "METRO CÚBICO", CAMION: "CAMIÓN" };
export function displayUnit(unit: string): string {
  return UNIT_DISPLAY[unit] ?? unit;
}

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
