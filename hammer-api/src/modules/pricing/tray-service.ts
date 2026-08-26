import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeActionLog } from "@/modules/brain/service";
import { assertPriceApplicable, applySuggestedPriceTx } from "@/modules/pricing/service";

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
 */
const APPLICABLE_TYPES = ["REVIEW_PRICE_BELOW_COST", "REVIEW_PRICE_MARGIN_POLICY", "REVIEW_BRANCH_COST_PRICE", "COST_CHANGED_PRICE_STALE"] as const;

export type PricingTrayReason = "BELOW_COST" | "MARGIN_POLICY" | "COST_STALE";

const REASON_TO_TYPES: Record<PricingTrayReason, readonly string[]> = {
  // REVIEW_PRICE_BELOW_COST y REVIEW_BRANCH_COST_PRICE son el mismo
  // síntoma ("el precio ya no cubre el costo") detectado por dos caminos
  // distintos del detector — misma sección "Vendiendo bajo el costo" en la
  // pantalla (§1.5).
  BELOW_COST: ["REVIEW_PRICE_BELOW_COST", "REVIEW_BRANCH_COST_PRICE"],
  MARGIN_POLICY: ["REVIEW_PRICE_MARGIN_POLICY"],
  COST_STALE: ["COST_CHANGED_PRICE_STALE"],
};

function reasonForType(type: string | null): PricingTrayReason {
  if (type === "REVIEW_PRICE_BELOW_COST" || type === "REVIEW_BRANCH_COST_PRICE") return "BELOW_COST";
  if (type === "REVIEW_PRICE_MARGIN_POLICY") return "MARGIN_POLICY";
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
  /** false cuando la decisión no trae un suggestedPrice aplicable (p.ej. REVIEW_BRANCH_COST_PRICE sin política resuelta) — la pantalla no debe dejarla seleccionar. */
  applicable: boolean;
  /** evidenceJson tal cual lo dejó el detector — para la fila expandible (§1.5). No se recalcula nada, es lectura directa de lo que Brain ya evaluó. */
  evidence: Record<string, unknown>;
};

export type PricingTrayResult = {
  rows: PricingTrayRow[];
  totals: {
    count: number;
    impactTotal: number;
    byReason: Record<PricingTrayReason, number>;
  };
};

/**
 * §1.3 — GET /api/master/pricing/tray. Consulta BrainDecision directamente,
 * ordenada por priorityScore desc y después impactAmount desc — la cola de
 * revisión que Brain ya calculó, no una nueva.
 */
export async function getPricingTray(filters: {
  branchId?: string;
  categoryId?: string;
  reason?: PricingTrayReason;
  severity?: string;
}): Promise<PricingTrayResult> {
  const typeFilter = filters.reason ? REASON_TO_TYPES[filters.reason] : APPLICABLE_TYPES;

  const decisions = await prisma.brainDecision.findMany({
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
    ? await prisma.branchProductSetting.findMany({
        where: { OR: pairs.map((p) => ({ branchId: p.branchId, productId: p.productId })) },
        select: { branchId: true, productId: true, lastPriceUpdateAt: true },
      })
    : [];
  const lastUpdateByKey = new Map(settings.map((s) => [`${s.branchId}:${s.productId}`, s.lastPriceUpdateAt]));

  const rows: PricingTrayRow[] = withTarget.map((d) => {
    const evidence = (d.evidenceJson ?? {}) as Record<string, unknown>;
    const proposed = (d.proposedActionJson ?? null) as Record<string, unknown> | null;
    const rawLastUpdate = lastUpdateByKey.get(`${d.branchId}:${d.productId}`);
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
      applicable: proposed !== null && typeof proposed.suggestedPrice === "number",
      evidence,
    };
  });

  const totals = {
    count: rows.length,
    impactTotal: rows.reduce((sum, r) => sum + r.impactAmount, 0),
    byReason: {
      BELOW_COST: rows.filter((r) => r.reason === "BELOW_COST").length,
      MARGIN_POLICY: rows.filter((r) => r.reason === "MARGIN_POLICY").length,
      COST_STALE: rows.filter((r) => r.reason === "COST_STALE").length,
    } as Record<PricingTrayReason, number>,
  };

  return { rows, totals };
}

export type ApplyTrayResult = {
  applied: Array<{ decisionId: string; branchId: string; productId: string; previousPrice: number | null; newPrice: number }>;
  failed: Array<{ decisionId: string; reason: string }>;
};

/**
 * §1.4 — POST /api/master/pricing/tray/apply. Cada decisión en SU PROPIA
 * transacción — si el producto 7 falla, los primeros 6 quedan aplicados.
 * assertPriceApplicable corre para cada una: el bloqueo por precio bajo el
 * costo interno sigue activo, aplicar en lote no lo suspende.
 */
export async function applyPricingTraySelection(input: { decisionIds: string[]; reason?: string; actorUserId: string }): Promise<ApplyTrayResult> {
  const applied: ApplyTrayResult["applied"] = [];
  const failed: ApplyTrayResult["failed"] = [];

  for (const decisionId of input.decisionIds) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const decision = await tx.brainDecision.findUniqueOrThrow({ where: { id: decisionId } });
        if (decision.category !== "PRICING") throw new Error("DECISION_NOT_PRICING");
        if (decision.status !== "OPEN") throw new Error("DECISION_NOT_OPEN");

        const proposed = decision.proposedActionJson as Record<string, unknown> | null;
        if (
          !proposed
          || typeof proposed.suggestedPrice !== "number"
          || typeof proposed.productId !== "string"
          || typeof proposed.branchId !== "string"
        ) {
          throw new Error("DECISION_MISSING_SUGGESTED_PRICE");
        }

        const snapshot = (proposed.calculationSnapshot ?? undefined) as Record<string, unknown> | undefined;
        const numField = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
        const applyInput = {
          productId: proposed.productId,
          branchId: proposed.branchId,
          applyScope: "BRANCH" as const,
          suggestedPrice: proposed.suggestedPrice,
          minPrice: numField(snapshot?.minPrice),
          maxPrice: numField(snapshot?.maxPrice) ?? null,
          totalInternalCost: numField(snapshot?.totalInternalCost),
          effectiveCost: numField(snapshot?.effectiveCost) ?? null,
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

        await tx.brainDecision.update({
          where: { id: decisionId },
          data: {
            status: "EXECUTED",
            resolvedAt: new Date(),
            resolvedByUserId: input.actorUserId,
            executedEntityType: "Product",
            executedEntityId: proposed.productId,
            actionResultJson: applyResult as unknown as Prisma.InputJsonValue,
          },
        });

        return { branchId: proposed.branchId, productId: proposed.productId, previousPrice: applyResult.previousPrice, newPrice: applyResult.newPrice };
      });

      await writeActionLog({
        decisionId,
        actorUserId: input.actorUserId,
        action: "PRICE_APPLIED_FROM_TRAY",
        note: input.reason,
        beforeStatus: "OPEN",
        afterStatus: "EXECUTED",
      });

      applied.push({ decisionId, ...result });
    } catch (error) {
      failed.push({ decisionId, reason: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
    }
  }

  return { applied, failed };
}
