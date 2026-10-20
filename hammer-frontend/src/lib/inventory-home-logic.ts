/**
 * prompt-inventario-inicio-fix.md Commit 2 — lógica pura del Inicio de
 * Inventario (tonos de los KPIs, bucketing de categorías y las filas de
 * "Para atender"): todo lo que decide QUÉ se muestra y CÓMO se colorea,
 * separado del componente para poder testearlo sin montar nada.
 */

export type StateCoverage = { expected: number; present: number };

/**
 * Commit 3 §3 — "Datos actualizándose (N% listo)": un solo porcentaje que
 * combina la cobertura de ProductBranchState (overview) y ProductCatalogState
 * (quality) — ambas las llena el mismo backfill, así que separarlas en dos
 * avisos sería ruido sin una razón real para el usuario. 100% cuando no hay
 * nada esperado (evita dividir por cero, nunca pasa en la práctica).
 */
export function combinedCoveragePercent(overviewCoverage: StateCoverage, qualityCoverage: StateCoverage): number {
  const expected = overviewCoverage.expected + qualityCoverage.expected;
  const present = overviewCoverage.present + qualityCoverage.present;
  return expected > 0 ? Math.round((present / expected) * 100) : 100;
}

export type KpiTone = "neutral" | "danger" | "warning";

/**
 * Los 3 KPI "de problema" — los únicos donde value=0 vale "Sin problemas" y
 * value>0 pinta. "Valor a costo", "Productos activos" y "Sin movimiento
 * 90 días" son informativos (la maqueta los deja en blanco/neutro incluso
 * con 178>0 — no son un "arreglalo ya", son una observación).
 */
export type ProblemKpiKind = "negativeStock" | "lowStock" | "noCostOrPrice";

/**
 * Commit 2 §3 — "un solo helper": neutro por defecto, rojo si hay
 * negativos, ámbar si hay pendientes — nunca decorativo, siempre atado al
 * valor real del KPI.
 */
export function kpiTone(kind: ProblemKpiKind, value: number): KpiTone {
  if (value <= 0) return "neutral";
  return kind === "negativeStock" ? "danger" : "warning";
}

export type CategoryBar = { name: string; value: number; isOther: boolean };

/**
 * Commit 2 §6 — "top 8 más 'Otras (N)' en gris": en la maqueta son 7
 * categorías con nombre + 1 barra "Otras" = 8 en total, no 8 + una más.
 */
export function bucketCategoryValues(categories: Array<{ name: string; value: number }>, topN = 7): CategoryBar[] {
  const sorted = [...categories].filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= topN) return sorted.map((c) => ({ ...c, isOther: false }));
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const otherValue = rest.reduce((sum, c) => sum + c.value, 0);
  return [...top.map((c) => ({ ...c, isOther: false })), { name: `Otras (${rest.length})`, value: otherValue, isOther: true }];
}

export type AttentionType = "NO_COST" | "NO_PRICE" | "COST_EQ_PRICE" | "NEGATIVE_STOCK" | "LOW_STOCK" | "STALE_TRANSFERS" | "FAILED_INTAKE";
export type AttentionDotTone = "danger" | "warning" | "info";

export type AttentionItem = {
  type: AttentionType;
  label: string;
  context: string;
  count: number;
  actionLabel: string;
  actionHref: string;
  dotTone: AttentionDotTone;
};

/** Mismo orden en que los lista el doc — desempata cuando dos tipos tienen el mismo conteo. */
const ATTENTION_ORDER: AttentionType[] = ["NO_COST", "NO_PRICE", "COST_EQ_PRICE", "NEGATIVE_STOCK", "LOW_STOCK", "STALE_TRANSFERS", "FAILED_INTAKE"];

export type InventoryAttentionCountsInput = {
  noCost: number;
  noPrice: number;
  costEqualsPrice: number;
  negativeStock: number;
  lowStock: number;
  staleTransfers: number;
  staleTransferSample: { transferNumber: string; fromBranchCode: string; toBranchCode: string } | null;
  failedIntakeLines: number;
  topMoversNoCost: number | null;
};

/**
 * Commit 2 §4 — una fila por tipo, "ordenado por impacto" (conteo
 * descendente) y solo los que tienen conteo mayor a 0. "Conteos por
 * aprobar" (el 8vo tipo del doc) no está acá: no existe ninguna entidad de
 * conteo-pendiente-de-aprobación en el sistema todavía (ver comentario en
 * getInventoryAttentionCounts, backend) — se agrega el día que exista, sin
 * inventar un conteo falso mientras tanto.
 */
export function buildAttentionItems(counts: InventoryAttentionCountsInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (counts.noCost > 0) {
    items.push({
      type: "NO_COST",
      label: "Sin costo",
      context: counts.topMoversNoCost ? `Los ${counts.topMoversNoCost} que más venden primero · no se puede medir la ganancia` : "No se puede medir la ganancia",
      count: counts.noCost,
      actionLabel: "Corregir →",
      actionHref: "/app/master/catalog-inventory?tab=products&filter=NO_COST",
      dotTone: "warning",
    });
  }
  if (counts.noPrice > 0) {
    items.push({
      type: "NO_PRICE",
      label: "Sin precio",
      context: "No se pueden vender en caja",
      count: counts.noPrice,
      actionLabel: "Poner precio →",
      actionHref: "/app/master/catalog-inventory?tab=products&filter=NO_PRICE",
      dotTone: "warning",
    });
  }
  if (counts.costEqualsPrice > 0) {
    items.push({
      type: "COST_EQ_PRICE",
      label: "Costo igual al precio",
      context: "Probable error de carga",
      count: counts.costEqualsPrice,
      actionLabel: "Revisar →",
      actionHref: "/app/master/catalog-inventory?tab=products",
      dotTone: "danger",
    });
  }
  if (counts.negativeStock > 0) {
    items.push({
      type: "NEGATIVE_STOCK",
      label: "Stock negativo",
      context: "Puede ser venta sin stock o traslado mal recibido",
      count: counts.negativeStock,
      actionLabel: "Revisar →",
      actionHref: "/app/master/catalog-inventory?tab=stock&filter=NEGATIVE_STOCK",
      dotTone: "danger",
    });
  }
  if (counts.lowStock > 0) {
    items.push({
      type: "LOW_STOCK",
      label: "Por agotarse",
      context: "Bajo el mínimo configurado",
      count: counts.lowStock,
      actionLabel: "Revisar →",
      actionHref: "/app/master/catalog-inventory?tab=stock&filter=LOW_STOCK",
      dotTone: "warning",
    });
  }
  if (counts.staleTransfers > 0) {
    const sample = counts.staleTransferSample;
    items.push({
      type: "STALE_TRANSFERS",
      label: "Traslados en tránsito más de 2 días",
      context: sample ? `${sample.fromBranchCode} → ${sample.toBranchCode} · ${sample.transferNumber}` : "Traslados despachados hace más de 2 días",
      count: counts.staleTransfers,
      actionLabel: "Ver →",
      actionHref: "/app/master/transfers",
      dotTone: "warning",
    });
  }
  if (counts.failedIntakeLines > 0) {
    items.push({
      type: "FAILED_INTAKE",
      label: "Entradas con error",
      context: "Reintentar o revisar el detalle",
      count: counts.failedIntakeLines,
      actionLabel: "Reintentar →",
      actionHref: "/app/master/catalog-inventory?tab=movements",
      dotTone: "danger",
    });
  }

  return items.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return ATTENTION_ORDER.indexOf(a.type) - ATTENTION_ORDER.indexOf(b.type);
  });
}
