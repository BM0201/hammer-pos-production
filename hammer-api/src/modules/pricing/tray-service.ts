import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeActionLog } from "@/modules/brain/service";
import { assertPriceApplicable, applySuggestedPriceTx, applyPriceAcrossBranches, marginForAppliedPrice, type ApplyPriceBranchResult } from "@/modules/pricing/service";
import { assertPriceNotBelowCost } from "@/modules/pricing/price-guard";
import { setBranchPriceTx } from "@/modules/pricing/branch-price-exception-service";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";
import { computeRealizedMarginBatch, computeUnits90dBatch, computeOtherBranchPricesBatch, realizedMarginUsable } from "@/modules/pricing/tray-context-service";

/**
 * Fase 1 (prompt-motor-precios-lote-herencia-gobierno.md) — la bandeja de
 * revisión de precios. La detección YA está hecha (pricing-detector.ts): la
 * bandeja solo lee BrainDecision (category PRICING, status OPEN) y aplica.
 * NO reimplementa nada del motor de cálculo ni de la detección.
 *
 * Los cuatro tipos de decisión con un precio sugerido listo para aplicar —
 * el resto de las decisiones PRICING (spread entre sucursales, CZ con
 * stock, fusiones, etc.) son informativas en Brain y no tienen lugar en
 * esta bandeja, que existe para decisiones con un botón "aplicar".
 *
 * docs/AUDITORIA-MOTOR-PRECIOS-COSTOS.md, hallazgo #2 — excepción a lo de
 * arriba: REVIEW_FUSION_UNSELLABLE (precio efectivo < costo efectivo en un
 * miembro de fusión, exactamente el guard BELOW_COST_NOT_ALLOWED que
 * bloquea la venta en el mostrador) SÍ entra acá, porque el síntoma es
 * IDÉNTICO a REVIEW_PRICE_BELOW_COST — un producto invendible hoy — y
 * antes de este fix Brain lo detectaba pero quedaba invisible: no
 * generaba proposedActionJson (checkStockGroupPricingHealth resuelve el
 * precio/costo por fusión, no calcula un precio sugerido), así que en la
 * bandeja aparece como fila informativa, checkbox deshabilitado, mismo
 * tratamiento que costLooksWrong — visible para que alguien lo revise, no
 * aplicable con un clic porque no hay un precio sugerido que aplicar. Los
 * otros cuatro FusionPricingIssueKind (MARGIN_OUTLIER, PLACEHOLDER_COST,
 * COST_BASIS_CONFLICT, PRICE_BASIS_CONFLICT) quedan fuera deliberadamente:
 * no tienen un precio/costo de un solo producto que esta fila sepa
 * mostrar (COST/PRICE_BASIS_CONFLICT implican varios productId a la vez).
 */
const APPLICABLE_TYPES = ["REVIEW_PRICE_BELOW_COST", "REVIEW_PRICE_MARGIN_POLICY", "REVIEW_BRANCH_COST_PRICE", "COST_CHANGED_PRICE_STALE", "REVIEW_FUSION_UNSELLABLE", "REVIEW_PRODUCT_NO_COST"] as const;

export type PricingTrayReason = "BELOW_COST" | "MARGIN_POLICY" | "COST_STALE" | "NO_COST";

const REASON_TO_TYPES: Record<PricingTrayReason, readonly string[]> = {
  // REVIEW_PRICE_BELOW_COST, REVIEW_BRANCH_COST_PRICE y REVIEW_FUSION_UNSELLABLE
  // son el mismo síntoma ("el precio ya no cubre el costo") detectado por
  // tres caminos distintos del detector — misma sección "Vendiendo bajo el
  // costo" en la pantalla (§1.5).
  BELOW_COST: ["REVIEW_PRICE_BELOW_COST", "REVIEW_BRANCH_COST_PRICE", "REVIEW_FUSION_UNSELLABLE"],
  MARGIN_POLICY: ["REVIEW_PRICE_MARGIN_POLICY"],
  COST_STALE: ["COST_CHANGED_PRICE_STALE"],
  // prompt-precios-vigilancia-movimiento.md — "cuando... no tenga costo, me
  // aparezca": sección propia, distinta de "vendiendo bajo el costo" (ahí sí
  // hay un costo, y es mayor al precio; acá directamente no hay costo con
  // qué comparar, así que no hay precio sugerido que aplicar).
  NO_COST: ["REVIEW_PRODUCT_NO_COST"],
};

function reasonForType(type: string | null): PricingTrayReason {
  if (type === "REVIEW_PRICE_BELOW_COST" || type === "REVIEW_BRANCH_COST_PRICE" || type === "REVIEW_FUSION_UNSELLABLE") return "BELOW_COST";
  if (type === "REVIEW_PRICE_MARGIN_POLICY") return "MARGIN_POLICY";
  if (type === "REVIEW_PRODUCT_NO_COST") return "NO_COST";
  return "COST_STALE";
}

function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type PricingTrayRow = {
  decisionId: string;
  severity: string;
  reason: PricingTrayReason;
  branchId: string;
  branchName: string;
  productId: string;
  productSku: string;
  productName: string;
  currentPrice: number | null;
  suggestedPrice: number | null;
  effectiveCost: number | null;
  marginActual: number | null;
  marginObjetivo: number | null;
  stockAtRisk: number | null;
  impactAmount: number;
  lastPriceUpdateAt: string | null;
  /** false cuando la decisión no trae un suggestedPrice aplicable (p.ej. REVIEW_BRANCH_COST_PRICE sin política resuelta), o cuando costLooksWrong — la pantalla no debe dejarla seleccionar. */
  applicable: boolean;
  /** Parte A (prompt-huecos-fase1-fase3-despliegue.md) — branchCost más de 2× el costo de referencia del producto: probablemente un error de tecleo, no un producto mal preciado. El precio sugerido se calculó sobre ese costo y hereda el error. */
  costLooksWrong: boolean;
  referenceCost: number | null;
  /** D.1.4 — mensaje de la sospecha de costo (COST_EQUALS_PRICE, PACKAGE_AS_UNIT) cuando costLooksWrong viene de ahí en vez de REVIEW_BRANCH_COST_PRICE; null para mantener el texto viejo de "costo de sucursal vs. promedio". */
  costSuspicionMessage: string | null;
  /** Parte C.2 — margen REALMENTE vendido (90 días, ponderado por cantidad), unidades vendidas y precio en otras sucursales. Calculados EN LOTE para toda la página, no uno por fila. null = sin datos suficientes. */
  realizedMarginPct: number | null;
  units90d: number | null;
  otherBranchPrices: { min: number; max: number; count: number } | null;
  /** evidenceJson tal cual lo dejó el detector — para la fila expandible (§1.5). No se recalcula nada, es lectura directa de lo que Brain ya evaluó. */
  evidence: Record<string, unknown>;
};

export type PricingTrayTotals = {
  count: number;
  impactTotal: number;
  byReason: Record<PricingTrayReason, number>;
  /** Parte A.4 — cuántas filas quedaron fuera de impactTotal por costo dudoso: un total contaminado por un error de tecleo es peor que no tener total. */
  costDoubtfulCount: number;
};

export type PricingTrayResult = {
  rows: PricingTrayRow[];
  totals: PricingTrayTotals;
  /**
   * Parte A (prompt-zona-precios-consolidacion.md) — el mismo cálculo que
   * `totals`, pero sobre TODAS las decisiones abiertas, sin los filtros del
   * usuario (branchId/categoryId/reason/severity). Sin esto, "totals" con
   * filtros puestos y cero resultados no se puede distinguir de "no hay
   * nada que revisar en ningún lado" — son afirmaciones distintas y la
   * pantalla las confundía.
   */
  unfilteredTotals: PricingTrayTotals;
};

/**
 * Pura (sin DB) — separada para poder probar que el total en riesgo
 * excluye impactAmount de las filas con costo dudoso sin base de datos
 * (A.4): ese monto se calculó con el costo inflado, y un total
 * contaminado es peor que no tener total.
 *
 * Recibe solo los tres campos que necesita (no PricingTrayRow completo) para
 * poder reusarla también sobre la consulta liviana sin joins de
 * unfilteredTotals (A.1), que no arma filas completas.
 */
export function computeTrayTotals(rows: Array<Pick<PricingTrayRow, "reason" | "impactAmount" | "costLooksWrong">>): PricingTrayTotals {
  const trustworthyRows = rows.filter((r) => !r.costLooksWrong);
  return {
    count: rows.length,
    impactTotal: trustworthyRows.reduce((sum, r) => sum + r.impactAmount, 0),
    byReason: {
      BELOW_COST: rows.filter((r) => r.reason === "BELOW_COST").length,
      MARGIN_POLICY: rows.filter((r) => r.reason === "MARGIN_POLICY").length,
      COST_STALE: rows.filter((r) => r.reason === "COST_STALE").length,
      NO_COST: rows.filter((r) => r.reason === "NO_COST").length,
    },
    costDoubtfulCount: rows.filter((r) => r.costLooksWrong).length,
  };
}

/**
 * §1.3 — GET /api/master/pricing/tray. Consulta BrainDecision directamente,
 * ordenada por priorityScore desc y después impactAmount desc — la cola de
 * revisión que Brain ya calculó, no una nueva.
 *
 * `db` es inyectable (mismo patrón que getExpenseSummaryByBranch en
 * pricing/service.ts) para poder probar el filtrado y unfilteredTotals con
 * un fake en memoria, sin base de datos real.
 */
export async function getPricingTray(
  filters: {
    branchId?: string;
    categoryId?: string;
    reason?: PricingTrayReason;
    severity?: string;
  },
  db: typeof prisma = prisma,
): Promise<PricingTrayResult> {
  const typeFilter = filters.reason ? REASON_TO_TYPES[filters.reason] : APPLICABLE_TYPES;

  const decisions = await db.brainDecision.findMany({
    where: {
      category: "PRICING",
      status: "OPEN",
      proposedActionType: { in: [...typeFilter] },
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
      ...(filters.severity ? { severity: filters.severity as Prisma.EnumBrainDecisionSeverityFilter } : {}),
      ...(filters.categoryId ? { product: { categoryId: filters.categoryId } } : {}),
    },
    include: {
      branch: { select: { id: true, name: true } },
      product: { select: { id: true, sku: true, name: true } },
    },
    orderBy: [{ priorityScore: "desc" }, { impactAmount: "desc" }],
    take: 500,
  });

  const withTarget = decisions.filter((d) => d.branchId !== null && d.productId !== null && d.branch !== null && d.product !== null);

  // lastPriceUpdateAt fresco desde BranchProductSetting — no confiar en
  // evidenceJson (su shape no es idéntica entre los cuatro tipos).
  const pairs = withTarget.map((d) => ({ branchId: d.branchId!, productId: d.productId! }));
  const settings = pairs.length > 0
    ? await db.branchProductSetting.findMany({
        where: { OR: pairs.map((p) => ({ branchId: p.branchId, productId: p.productId })) },
        select: { branchId: true, productId: true, lastPriceUpdateAt: true },
      })
    : [];
  const lastUpdateByKey = new Map(settings.map((s) => [`${s.branchId}:${s.productId}`, s.lastPriceUpdateAt]));

  // Parte C.2 — margen realizado, unidades 90d y precios en otras
  // sucursales, EN LOTE para toda la página (una agregación cada uno, no
  // una por fila).
  const [realizedByKey, units90dByKey, otherBranchPricesByKey] = pairs.length > 0
    ? await Promise.all([
        computeRealizedMarginBatch(db, pairs),
        computeUnits90dBatch(db, pairs),
        computeOtherBranchPricesBatch(db, pairs),
      ])
    : [new Map(), new Map(), new Map()];

  const rows: PricingTrayRow[] = withTarget.map((d) => {
    const evidence = (d.evidenceJson ?? {}) as Record<string, unknown>;
    const proposed = (d.proposedActionJson ?? null) as Record<string, unknown> | null;
    const key = `${d.branchId}:${d.productId}`;
    const rawLastUpdate = lastUpdateByKey.get(key);
    const costLooksWrong = evidence.costLooksWrong === true;
    const realized = realizedByKey.get(key) ?? null;
    return {
      decisionId: d.id,
      severity: d.severity,
      reason: reasonForType(d.proposedActionType),
      branchId: d.branchId!,
      branchName: d.branch!.name,
      productId: d.productId!,
      productSku: d.product!.sku,
      productName: d.product!.name,
      currentPrice: num(evidence.currentPrice ?? evidence.effectivePrice ?? evidence.price),
      suggestedPrice: num(evidence.suggestedPrice),
      effectiveCost: num(evidence.effectiveCost ?? evidence.cost),
      marginActual: num(evidence.marginActual),
      marginObjetivo: num(evidence.marginObjetivo),
      stockAtRisk: num(evidence.stockAtRisk ?? evidence.stock),
      impactAmount: num(d.impactAmount) ?? 0,
      lastPriceUpdateAt: rawLastUpdate ? rawLastUpdate.toISOString() : null,
      // A.2 — sacar el checkbox cuando el costo se ve mal: el precio
      // sugerido se calculó sobre ese costo y hereda el error.
      applicable: proposed !== null && typeof proposed.suggestedPrice === "number" && !costLooksWrong,
      costLooksWrong,
      referenceCost: num(evidence.referenceCost),
      costSuspicionMessage: typeof evidence.costSuspicionMessage === "string" ? evidence.costSuspicionMessage : null,
      realizedMarginPct: realizedMarginUsable(realized) ? realized.marginPct : null,
      units90d: units90dByKey.get(key) ?? null,
      otherBranchPrices: otherBranchPricesByKey.get(key) ?? null,
      evidence,
    };
  });

  // A.1 — totales SIN los filtros del usuario: consulta APARTE y barata, sin
  // joins (nada de include de branch/product, sin el take:500 de arriba —
  // ese límite es para lo que se muestra, no para contar). Deliberadamente
  // NO uso groupBy (aunque sea más barato) porque necesito excluir el
  // impactAmount de las decisiones con costo dudoso del impactTotal — mismo
  // criterio que `totals` (A.4) — y esa exclusión vive en evidenceJson, que
  // un groupBy no puede filtrar de forma portable entre motores. Un solo
  // findMany con select mínimo sigue siendo barato: no hay joins.
  const allOpenForTotals = await db.brainDecision.findMany({
    where: {
      category: "PRICING",
      status: "OPEN",
      proposedActionType: { in: [...APPLICABLE_TYPES] },
    },
    select: { proposedActionType: true, impactAmount: true, evidenceJson: true },
  });
  const unfilteredTotals = computeTrayTotals(
    allOpenForTotals.map((d) => ({
      reason: reasonForType(d.proposedActionType),
      impactAmount: num(d.impactAmount) ?? 0,
      costLooksWrong: (d.evidenceJson as Record<string, unknown> | null)?.costLooksWrong === true,
    })),
  );

  return { rows, totals: computeTrayTotals(rows), unfilteredTotals };
}

/**
 * C.1.1 (prompt-completo-pendientes-2026-10.md) — "la política sugiere y
 * el dueño decide": qué número se terminó aplicando y por qué camino.
 * `method` lo manda la pantalla (Fase 4); hasta que exista, el default es
 * MANUAL si vino `price`, o SUGGESTED si no.
 */
export type PriceApplyMethod = "MANUAL" | "SUGGESTED" | "REALIZED_MARGIN" | "KEEP_GAIN_AMOUNT" | "KEEP_MARGIN_PCT" | "OTHER_BRANCH" | "POLICY_MIN";

export type ApplyTrayItem = {
  decisionId: string;
  /** Si viene, se aplica ESE precio (elegido a mano o por un chip de referencia). Sin esto, se aplica el sugerido del motor, como antes. */
  price?: number;
  method?: PriceApplyMethod;
  /** "Aplicar también en…" — otras sucursales que reciben el MISMO precio, cada una con su propia guarda de costo; una que falla no tumba las demás. */
  alsoBranchIds?: string[];
};

export type ApplyTrayResult = {
  applied: Array<{
    decisionId: string; branchId: string; productId: string; previousPrice: number | null; newPrice: number;
    alsoBranches?: ApplyPriceBranchResult[];
  }>;
  failed: Array<{ decisionId: string; reason: string }>;
};

/**
 * El cuerpo transaccional de UNA decisión, separado del bucle para poder
 * probarlo con un tx en memoria — mismo patrón que
 * applySuggestedPriceTx/clearBranchPriceExceptionTx. A.3: sacar el
 * checkbox es comodidad, no control — el payload se puede editar y este
 * endpoint escribe precios de venta, así que costLooksWrong se rechaza
 * ACÁ también, sin escribir nada, antes de tocar applySuggestedPriceTx.
 *
 * C.1.1 — atomicidad: `FOR UPDATE` + `updateMany` condicionado a OPEN,
 * mismo idioma que price-update-batch-apply-service.ts (único lugar de
 * este módulo que ya lo usaba). Doble envío → ALREADY_PROCESSED en el
 * segundo, no una excepción genérica.
 */
export async function applyOneTrayDecisionTx(
  tx: Prisma.TransactionClient,
  decisionId: string,
  input: { reason?: string; actorUserId: string; price?: number; method?: PriceApplyMethod },
): Promise<{ branchId: string; productId: string; previousPrice: number | null; newPrice: number }> {
  await tx.$queryRaw`SELECT id FROM "BrainDecision" WHERE id = ${decisionId} FOR UPDATE`;
  const decision = await tx.brainDecision.findUniqueOrThrow({ where: { id: decisionId } });
  if (decision.category !== "PRICING") throw new Error("DECISION_NOT_PRICING");
  if (decision.status !== "OPEN") throw new Error("ALREADY_PROCESSED");

  const evidence = decision.evidenceJson as Record<string, unknown> | null;
  if (evidence?.costLooksWrong === true) throw new Error("COST_REQUIRES_REVIEW");

  const proposed = decision.proposedActionJson as Record<string, unknown> | null;
  if (!proposed || typeof proposed.productId !== "string" || typeof proposed.branchId !== "string") {
    throw new Error("DECISION_MISSING_SUGGESTED_PRICE");
  }
  const suggestedByEngine = typeof proposed.suggestedPrice === "number" ? proposed.suggestedPrice : null;
  const chosenPrice = input.price ?? suggestedByEngine;
  if (chosenPrice === null || !(chosenPrice > 0)) throw new Error("DECISION_MISSING_SUGGESTED_PRICE");

  // "Bajo el costo nunca se aplica, ni a mano" — el costo EFECTIVO de ESA
  // sucursal, recalculado adentro de la transacción (no el de la decisión,
  // que puede estar desactualizado si el costo cambió después de detectarla).
  const effective = await getEffectiveProductPricing(tx, { branchId: proposed.branchId, productId: proposed.productId });
  const effectiveCostNow = effective.effectiveCost === null ? null : Number(effective.effectiveCost);
  assertPriceNotBelowCost({ price: chosenPrice, cost: effectiveCostNow });

  const snapshot = (proposed.calculationSnapshot ?? undefined) as Record<string, unknown> | undefined;
  const numField = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  const applyInput = {
    productId: proposed.productId,
    branchId: proposed.branchId,
    applyScope: "BRANCH" as const,
    suggestedPrice: chosenPrice,
    minPrice: numField(snapshot?.minPrice),
    maxPrice: numField(snapshot?.maxPrice) ?? null,
    totalInternalCost: numField(snapshot?.totalInternalCost) ?? (effectiveCostNow ?? undefined),
    effectiveCost: effectiveCostNow ?? numField(snapshot?.effectiveCost) ?? null,
    marginPercent: numField(snapshot?.marginPercent),
    grossMarginPercent: numField(snapshot?.grossMarginPercent),
    markupPercent: numField(snapshot?.markupPercent),
    roundingRule: typeof snapshot?.roundingRule === "string" ? snapshot.roundingRule : undefined,
    reason: input.reason ?? "Aplicado desde la bandeja de precios",
    calculationSnapshot: snapshot,
  };

  // NO saltear la validación — el bloqueo por precio bajo el costo
  // interno existe por una razón y aplicar en lote no lo suspende.
  const warnings = assertPriceApplicable(applyInput);

  const applyResult = await applySuggestedPriceTx(
    tx,
    { ...applyInput, actorUserId: input.actorUserId },
    proposed.branchId,
    warnings,
  );

  const method: PriceApplyMethod = input.method ?? (input.price !== undefined ? "MANUAL" : "SUGGESTED");
  const resolutionNote = method === "MANUAL"
    ? `Precio elegido a mano: C$ ${chosenPrice.toFixed(2)}${suggestedByEngine !== null ? ` (sugerido del motor: C$ ${suggestedByEngine.toFixed(2)})` : ""}`
    : "Aplicado desde la Bandeja de precios";

  // prompt-brain-centro-decisiones.md Fase 4.2 — RESOLVED/EXECUTION, no
  // EXECUTED: "EXECUTED" ahora es el estado de runBrainDecision (el motor
  // de Brain ejecutó algo él mismo); esto es un camino DISTINTO — el precio
  // se aplicó desde la Bandeja de precios, no desde Brain. USER cuando el
  // dueño eligió el número a mano, EXECUTION cuando aplicó el sugerido tal
  // cual (igual que lo deja la Carga de precios).
  const updated = await tx.brainDecision.updateMany({
    where: { id: decisionId, status: "OPEN" },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedByUserId: input.actorUserId,
      resolutionSource: method === "MANUAL" ? "USER" : "EXECUTION",
      resolutionNote,
      executedEntityType: "Product",
      executedEntityId: proposed.productId,
      actionResultJson: { ...applyResult, suggestedByEngine, chosenPrice, method } as unknown as Prisma.InputJsonValue,
    },
  });
  if (updated.count === 0) throw new Error("ALREADY_PROCESSED");

  await tx.brainDecisionActionLog.create({
    data: {
      decisionId,
      actorUserId: input.actorUserId,
      action: "RESOLVED",
      note: resolutionNote,
      metadataJson: { reason: method === "MANUAL" ? "USER" : "EXECUTION", source: "pricing-tray", suggestedByEngine, chosenPrice, method } as unknown as Prisma.InputJsonValue,
    },
  });

  return { branchId: proposed.branchId, productId: proposed.productId, previousPrice: applyResult.previousPrice, newPrice: applyResult.newPrice };
}

/**
 * C.1.1 — "aplicar también en…": el MISMO precio en otras sucursales,
 * cada una en su propia transacción (mismo principio que
 * applyPriceAcrossBranches — una que falla no tumba las demás), con su
 * propia guarda de costo. Las decisiones PRICING abiertas de ese producto
 * en esa sucursal también se cierran: ya no están desactualizadas.
 */
export async function applyAlsoBranchPriceTx(
  tx: Prisma.TransactionClient,
  branchId: string,
  productId: string,
  price: number,
  actorUserId: string,
): Promise<{ previousPrice: Prisma.Decimal | null; setting: { branchPrice: Prisma.Decimal | null } }> {
  const effective = await getEffectiveProductPricing(tx, { branchId, productId });
  const effectiveCostNow = effective.effectiveCost === null ? null : Number(effective.effectiveCost);
  assertPriceNotBelowCost({ price, cost: effectiveCostNow });

  const result = await setBranchPriceTx(tx, {
    branchId,
    productId,
    branchPrice: new Prisma.Decimal(price),
    exceptionReason: "Aplicado también desde la Bandeja de precios",
    priceSource: "CALCULATED",
    actorUserId,
    origin: "bandeja_precios",
  });

  await tx.brainDecision.updateMany({
    where: { category: "PRICING", status: "OPEN", productId, branchId },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedByUserId: actorUserId,
      resolutionSource: "USER",
      resolutionNote: "Precio igualado desde otra sucursal (Bandeja de precios)",
    },
  });

  return result;
}

async function applyAlsoBranchPrice(branchId: string, productId: string, price: number, actorUserId: string) {
  const { previousPrice } = await prisma.$transaction((tx) => applyAlsoBranchPriceTx(tx, branchId, productId, price, actorUserId));
  const { marginPercent, minMarginPercent } = await marginForAppliedPrice(branchId, productId, price);
  return { previousPrice: previousPrice === null ? null : Number(previousPrice), newPrice: price, marginPercent, minMarginPercent };
}

/**
 * §1.4 — POST /api/master/pricing/tray/apply. Cada decisión en SU PROPIA
 * transacción — si el producto 7 falla, los primeros 6 quedan aplicados.
 */
export async function applyPricingTraySelection(input: { items: ApplyTrayItem[]; reason?: string; actorUserId: string }): Promise<ApplyTrayResult> {
  const applied: ApplyTrayResult["applied"] = [];
  const failed: ApplyTrayResult["failed"] = [];

  for (const item of input.items) {
    try {
      const result = await prisma.$transaction((tx) => applyOneTrayDecisionTx(tx, item.decisionId, {
        reason: input.reason,
        actorUserId: input.actorUserId,
        price: item.price,
        method: item.method,
      }));

      await writeActionLog({
        decisionId: item.decisionId,
        actorUserId: input.actorUserId,
        action: "PRICE_APPLIED_FROM_TRAY",
        note: input.reason,
        beforeStatus: "OPEN",
        afterStatus: "EXECUTED",
      });

      let alsoBranches: ApplyPriceBranchResult[] | undefined;
      if (item.alsoBranchIds && item.alsoBranchIds.length > 0) {
        const { results } = await applyPriceAcrossBranches(
          item.alsoBranchIds,
          result.newPrice,
          (branchId) => applyAlsoBranchPrice(branchId, result.productId, result.newPrice, input.actorUserId),
        );
        alsoBranches = results;
      }

      applied.push({ decisionId: item.decisionId, ...result, ...(alsoBranches ? { alsoBranches } : {}) });
    } catch (error) {
      failed.push({ decisionId: item.decisionId, reason: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
    }
  }

  return { applied, failed };
}

/**
 * C.1.2 — "mantener el precio actual": el dueño revisó el precio y decide
 * que está bien así, SIN aplicar ningún número nuevo. Solo tiene sentido
 * para los dos tipos donde el precio en sí no está mal (política de
 * margen, costo que cambió) — bajo el costo nunca se puede "mantener",
 * hay que corregir precio o costo.
 */
const KEEPABLE_TYPES = new Set(["REVIEW_PRICE_MARGIN_POLICY", "COST_CHANGED_PRICE_STALE"]);

export type KeepPriceResult = {
  kept: string[];
  rejected: Array<{ decisionId: string; reason: string }>;
};

export async function keepOneTrayPriceTx(
  tx: Prisma.TransactionClient,
  decisionId: string,
  input: { note: string; actorUserId: string },
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "BrainDecision" WHERE id = ${decisionId} FOR UPDATE`;
  const decision = await tx.brainDecision.findUniqueOrThrow({ where: { id: decisionId } });
  if (decision.category !== "PRICING") throw new Error("DECISION_NOT_PRICING");
  if (decision.status !== "OPEN") throw new Error("ALREADY_PROCESSED");
  if (!decision.proposedActionType || !KEEPABLE_TYPES.has(decision.proposedActionType)) {
    throw new Error("NOT_KEEPABLE: Bajo el costo no se puede mantener: corregí el precio o el costo");
  }
  if (decision.branchId === null || decision.productId === null) throw new Error("DECISION_MISSING_SUGGESTED_PRICE");

  const effective = await getEffectiveProductPricing(tx, { branchId: decision.branchId, productId: decision.productId });
  const effectiveCostNow = effective.effectiveCost === null ? null : Number(effective.effectiveCost);
  const evidence = decision.evidenceJson as Record<string, unknown> | null;
  const currentPrice = num(evidence?.currentPrice ?? evidence?.effectivePrice ?? evidence?.price);

  await tx.branchProductSetting.upsert({
    where: { branchId_productId: { branchId: decision.branchId, productId: decision.productId } },
    update: {
      priceReviewedAt: new Date(),
      priceReviewedPrice: currentPrice !== null ? new Prisma.Decimal(currentPrice) : null,
      priceReviewedCost: effectiveCostNow !== null ? new Prisma.Decimal(effectiveCostNow) : null,
      priceReviewedByUserId: input.actorUserId,
      priceReviewNote: input.note,
    },
    create: {
      branchId: decision.branchId,
      productId: decision.productId,
      priceReviewedAt: new Date(),
      priceReviewedPrice: currentPrice !== null ? new Prisma.Decimal(currentPrice) : null,
      priceReviewedCost: effectiveCostNow !== null ? new Prisma.Decimal(effectiveCostNow) : null,
      priceReviewedByUserId: input.actorUserId,
      priceReviewNote: input.note,
    },
  });

  const resolutionNote = `Precio mantenido: ${input.note}`;
  const updated = await tx.brainDecision.updateMany({
    where: { id: decisionId, status: "OPEN" },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedByUserId: input.actorUserId,
      resolutionSource: "USER",
      resolutionNote,
    },
  });
  if (updated.count === 0) throw new Error("ALREADY_PROCESSED");

  await tx.brainDecisionActionLog.create({
    data: {
      decisionId,
      actorUserId: input.actorUserId,
      action: "RESOLVED",
      note: resolutionNote,
      metadataJson: { reason: "USER", source: "pricing-tray-keep" } as unknown as Prisma.InputJsonValue,
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      branchId: decision.branchId,
      module: "pricing",
      action: "PRICE_REVIEW_KEPT",
      entityType: "Product",
      entityId: decision.productId,
      metadataJson: {
        productId: decision.productId,
        branchId: decision.branchId,
        decisionId,
        note: input.note,
        priceReviewedPrice: currentPrice,
        priceReviewedCost: effectiveCostNow,
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * §C.1.2 — POST /api/master/pricing/tray/keep. Cada decisión en su propia
 * transacción, igual que applyPricingTraySelection — una que se rechaza
 * (bajo el costo, o ya resuelta) no tumba las demás.
 */
export async function keepPricingTraySelection(input: { decisionIds: string[]; note: string; actorUserId: string }): Promise<KeepPriceResult> {
  const kept: string[] = [];
  const rejected: KeepPriceResult["rejected"] = [];

  for (const decisionId of input.decisionIds) {
    try {
      await prisma.$transaction((tx) => keepOneTrayPriceTx(tx, decisionId, { note: input.note, actorUserId: input.actorUserId }));
      kept.push(decisionId);
    } catch (error) {
      rejected.push({ decisionId, reason: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
    }
  }

  return { kept, rejected };
}
