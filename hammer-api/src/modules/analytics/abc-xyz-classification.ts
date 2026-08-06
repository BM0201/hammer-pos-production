/**
 * Fuente de verdad única para la decisión de clase ABC-XYZ (prompt-precios-
 * fase0.md). Antes de este módulo, `analytics/abc-classifier.ts` decidía la
 * clase al escribir en BD y `pricing/commercial-intelligence.ts` volvía a
 * decidir en memoria con sus propios umbrales — dos criterios distintos para
 * la misma pregunta. Este módulo es el ÚNICO lugar donde vive la decisión;
 * ambos lados le pasan sus insumos y usan el resultado.
 *
 * ── Precedencia stored-vs-calculado (regla única, sin un tercer criterio) ──
 * La clase PERSISTIDA en `Product.abcClassification`/`xyzClassification`
 * (escrita por el job batch de analytics, `calculateABCClassification`/
 * `calculateXYZClassification`) es la AUTORIDAD. El cálculo en vivo de acá
 * es el FALLBACK — solo se usa para productos que el job de analytics
 * todavía no clasificó, o para vistas que evalúan un producto aislado sin
 * correr el job completo. Nunca hay un tercer criterio.
 *
 * ── Dos métodos ABC coexisten (no se cambia ninguno en esta fase) ──
 * 1. `cumulativeValuePercent` (+ `isFirstInRanking`): método clásico ABC —
 *    ranking descendente por valor de TODOS los productos del período, %
 *    acumulado hasta este producto inclusive. Es el método del job batch de
 *    analytics; requiere conocer el ranking completo, no solo este producto.
 * 2. `individualContributionPercent`: contribución de valor de ESTE producto
 *    aislado (sin ranking contra los demás). Es el método de fallback de
 *    commercial-intelligence para cuando se evalúa un producto sin correr el
 *    job completo (ej. una alerta en vivo).
 * Ambos coexistían con umbrales propios en cada archivo; acá viven como dos
 * ramas del mismo `resolveAbcXyzClassification`, con sus umbrales en el
 * mismo objeto `AbcXyzThresholds` (nunca duplicados en dos lugares).
 *
 * ── XYZ: una sola fórmula (CV) + un fallback por unidades vendidas ──
 * El cálculo por coeficiente de variación (CV) es el mismo en ambos lados
 * (0.5/1.0) — la única divergencia real era el OPERADOR de comparación:
 * abc-classifier usaba `<` estricto (cv=0.5 exacto → Y), commercial-
 * intelligence usaba `<=` inclusivo (cv=0.5 exacto → X). Se adoptó `<=`
 * (inclusivo) como canónico: es la convención estándar de literatura de
 * inventarios (X: CV entre 0 y 0.5 inclusive) y es la que ya afectaba a los
 * ~9 consumidores en vivo de pricing; el job batch de analytics solo pierde
 * el borde exacto cv=0.5/1.0 (caso raro), y sus valores se recalculan cada
 * mes de todas formas. Este es el único cambio de comportamiento de esta
 * fase — documentado acá y en el reporte final, no en umbrales de negocio.
 * El fallback por `unitsSoldLast90Days` (cuando no hay CV disponible) es
 * exclusivo de commercial-intelligence; se preserva tal cual.
 *
 * ── Datos insuficientes para XYZ ──
 * Con menos de `xyzMinDataPoints` días con venta, se fuerza Z sin calcular
 * CV (un CV de 2 muestras idénticas daría 0 = "estable", pero 2 muestras no
 * prueban estabilidad). TODO(Fase 1): separar "sin datos" de "Z errático" —
 * hoy ambos casos comparten la misma clase Z, ver prompt-precios-fase0.md.
 */

export type AbcClass = "A" | "B" | "C";
export type XyzClass = "X" | "Y" | "Z";
export type CombinedAbcXyzClass = `${AbcClass}${XyzClass}`;

export type AbcXyzThresholds = {
  /** Método 1 (ranking/batch): % acumulado hasta el cual un producto es A. */
  abcCumulativePercentA: number;
  /** Método 1 (ranking/batch): % acumulado hasta el cual un producto es B (el resto es C). */
  abcCumulativePercentB: number;
  /** Método 2 (contribución individual, fallback en vivo): % de contribución individual mínimo para A. */
  abcContributionPercentA: number;
  /** Método 2 (contribución individual, fallback en vivo): % de contribución individual mínimo para B (el resto es C). */
  abcContributionPercentB: number;
  /** Coeficiente de variación máximo (inclusive) para X. */
  xyzCvMaxX: number;
  /** Coeficiente de variación máximo (inclusive) para Y (el resto es Z). */
  xyzCvMaxY: number;
  /** Fallback XYZ sin CV: unidades vendidas en 90 días mínimas (inclusive) para X. */
  xyzUnitsSoldMinX: number;
  /** Fallback XYZ sin CV: unidades vendidas en 90 días mínimas (inclusive) para Y (el resto es Z). */
  xyzUnitsSoldMinY: number;
  /** Mínimo de puntos de dato (días con venta) para confiar en un CV calculado; menos de esto fuerza Z. */
  xyzMinDataPoints: number;
};

// Fase 0: valores actuales de ambos módulos, ahora en un solo lugar.
// Fase 1 los vuelve configurables (por categoría/negocio) — por eso ya viven
// como parámetro con default, no como constante clavada en el cuerpo.
export const DEFAULT_ABC_XYZ_THRESHOLDS: AbcXyzThresholds = {
  abcCumulativePercentA: 80,
  abcCumulativePercentB: 95,
  abcContributionPercentA: 5,
  abcContributionPercentB: 1,
  xyzCvMaxX: 0.5,
  xyzCvMaxY: 1.0,
  xyzUnitsSoldMinX: 90,
  xyzUnitsSoldMinY: 15,
  xyzMinDataPoints: 3,
};

export type AbcXyzClassificationInput = {
  // Precedencia 1 — clase ya persistida (autoridad). Si viene, gana siempre.
  storedAbcClass?: string | null;
  storedXyzClass?: string | null;

  // ABC método 1 (ranking/batch) — mutuamente excluyente con método 2.
  cumulativeValuePercent?: number;
  isFirstInRanking?: boolean;

  // ABC método 2 (contribución individual, fallback en vivo).
  individualContributionPercent?: number;

  // XYZ — coeficiente de variación (mismo cálculo en ambos lados).
  coefficientOfVariation?: number;
  /** Días con dato de venta que respaldan `coefficientOfVariation`. Si se
   *  provee y es menor a `xyzMinDataPoints`, fuerza Z sin mirar el CV. */
  xyzDataPoints?: number;

  // XYZ fallback sin CV (solo usado por commercial-intelligence hoy).
  unitsSoldLast90Days?: number;
};

export type AbcXyzClassificationResult = {
  abcClass: AbcClass;
  xyzClass: XyzClass;
  combinedClass: CombinedAbcXyzClass;
  warnings: string[];
};

const VALID_ABC = new Set(["A", "B", "C"]);
const VALID_XYZ = new Set(["X", "Y", "Z"]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function resolveAbcClass(
  input: AbcXyzClassificationInput,
  thresholds: AbcXyzThresholds,
  warnings: string[],
): AbcClass {
  if (input.storedAbcClass && VALID_ABC.has(input.storedAbcClass)) {
    return input.storedAbcClass as AbcClass;
  }

  if (input.isFirstInRanking) return "A";

  if (isFiniteNumber(input.cumulativeValuePercent)) {
    if (input.cumulativeValuePercent <= thresholds.abcCumulativePercentA) return "A";
    if (input.cumulativeValuePercent <= thresholds.abcCumulativePercentB) return "B";
    return "C";
  }

  if (isFiniteNumber(input.individualContributionPercent)) {
    if (input.individualContributionPercent >= thresholds.abcContributionPercentA) return "A";
    if (input.individualContributionPercent >= thresholds.abcContributionPercentB) return "B";
    return "C";
  }

  warnings.push("Sin datos suficientes de ventas para clasificacion ABC; se uso C como fallback.");
  return "C";
}

function resolveXyzClass(
  input: AbcXyzClassificationInput,
  thresholds: AbcXyzThresholds,
  warnings: string[],
): XyzClass {
  if (input.storedXyzClass && VALID_XYZ.has(input.storedXyzClass)) {
    return input.storedXyzClass as XyzClass;
  }

  if (isFiniteNumber(input.xyzDataPoints) && input.xyzDataPoints < thresholds.xyzMinDataPoints) {
    // TODO(Fase 1): distinguir "sin datos suficientes" de "Z realmente errático".
    return "Z";
  }

  if (isFiniteNumber(input.coefficientOfVariation)) {
    if (input.coefficientOfVariation <= thresholds.xyzCvMaxX) return "X";
    if (input.coefficientOfVariation <= thresholds.xyzCvMaxY) return "Y";
    return "Z";
  }

  if (isFiniteNumber(input.unitsSoldLast90Days)) {
    if (input.unitsSoldLast90Days >= thresholds.xyzUnitsSoldMinX) return "X";
    if (input.unitsSoldLast90Days >= thresholds.xyzUnitsSoldMinY) return "Y";
    return "Z";
  }

  warnings.push("Sin datos suficientes de demanda para clasificacion XYZ; se uso Z como fallback.");
  return "Z";
}

/**
 * Función canónica: única decisión de clase ABC-XYZ del sistema. Ver
 * comentario de módulo para la regla de precedencia y los dos métodos ABC.
 */
export function resolveAbcXyzClassification(
  input: AbcXyzClassificationInput,
  thresholds: AbcXyzThresholds = DEFAULT_ABC_XYZ_THRESHOLDS,
): AbcXyzClassificationResult {
  const warnings: string[] = [];
  const abcClass = resolveAbcClass(input, thresholds, warnings);
  const xyzClass = resolveXyzClass(input, thresholds, warnings);

  return {
    abcClass,
    xyzClass,
    combinedClass: `${abcClass}${xyzClass}` as CombinedAbcXyzClass,
    warnings,
  };
}
