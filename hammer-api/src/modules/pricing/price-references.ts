import { Prisma } from "@prisma/client";
import { applyRounding, type RoundingRule } from "@/modules/pricing/calculator";

/**
 * Parte C.2 (prompt-completo-pendientes-2026-10.md) — "los otros métodos":
 * cada referencia es una función PURA de números ya resueltos (costo
 * efectivo de ESA sucursal, política, ventas de 90 días, costo anterior,
 * precios de otras sucursales) — nada de fetch acá. El orquestador (quien
 * llama a esto) junta esos números una sola vez y los pasa; así se puede
 * probar con números a mano, sin base de datos.
 */

export type PriceReferenceMethod =
  | "KEEP_CURRENT"
  | "SUGGESTED"
  | "REALIZED_MARGIN"
  | "KEEP_GAIN_AMOUNT"
  | "KEEP_MARGIN_PCT"
  | "POLICY_MIN"
  | "OTHER_BRANCH";

export type PriceReference = {
  method: PriceReferenceMethod;
  label: string;
  price: number | null;
  gainAmount: number | null;
  marginOnPrice: number | null;
  markupOnCost: number | null;
  basis: string | null;
  available: boolean;
  reason?: string;
};

export type SuggestedBreakdown = {
  targetMarginPercent: number;
  abcXyzClass: string;
  marginDelta: number;
  marginAfterAdjustment: number;
  flooredByPolicy: boolean;
  operatingExpensePerUnit: number;
  minProfitAmount: number;
  roundingRule: RoundingRule;
  rawPrice: number;
  finalPrice: number;
};

export type PriceReferenceInput = {
  currentPrice: number | null;
  effectiveCost: number | null;
  roundingRule: RoundingRule;
  policyMinMarginPercent: number;
  /** null = sin costo, el motor no puede sugerir nada. */
  suggested: SuggestedBreakdown | null;
  /** null = sin ventas suficientes en los últimos 90 días. */
  realizedMargin: { marginPct: number; lineCount: number; distinctSaleDays: number } | null;
  /** El costo ANTES del cambio que disparó la revisión — priceReviewedCost, o el costSnapshot de la última venta antes del cambio. null = sin costo anterior confiable. */
  priorCost: number | null;
  otherBranches: Array<{ branchId: string; branchName: string; price: number }>;
};

const MIN_LINES_FOR_REALIZED_MARGIN = 5;
const MIN_DAYS_FOR_REALIZED_MARGIN = 3;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function gainAndMargin(price: number | null, cost: number | null): { gainAmount: number | null; marginOnPrice: number | null; markupOnCost: number | null } {
  if (price === null || cost === null) return { gainAmount: null, marginOnPrice: null, markupOnCost: null };
  const gainAmount = round2(price - cost);
  const marginOnPrice = price > 0 ? round2(((price - cost) / price) * 100) : null;
  const markupOnCost = cost > 0 ? round2(((price - cost) / cost) * 100) : null;
  return { gainAmount, marginOnPrice, markupOnCost };
}

/** costo / (1 − margen/100) — el precio que da ESE margen sobre el precio, con el costo dado. */
function priceForMargin(cost: number, marginPct: number): number | null {
  const fraction = marginPct / 100;
  if (fraction >= 1) return null; // 100%+ de margen no es un precio real (división por 0 o negativo)
  return cost / (1 - fraction);
}

function rounded(price: number, rule: RoundingRule): number {
  return Number(applyRounding(new Prisma.Decimal(price), rule).toFixed(2));
}

export function buildPriceReferences(input: PriceReferenceInput): PriceReference[] {
  const refs: PriceReference[] = [];

  // KEEP_CURRENT — nunca inaplica, aunque no haya precio (la fila lo muestra vacío).
  {
    const { gainAmount, marginOnPrice, markupOnCost } = gainAndMargin(input.currentPrice, input.effectiveCost);
    refs.push({ method: "KEEP_CURRENT", label: "Mantener actual", price: input.currentPrice, gainAmount, marginOnPrice, markupOnCost, basis: null, available: true });
  }

  // SUGGESTED — lo que hoy calcula el motor, con su desglose.
  if (input.suggested === null) {
    refs.push({ method: "SUGGESTED", label: "Sugerido por política", price: null, gainAmount: null, marginOnPrice: null, markupOnCost: null, basis: null, available: false, reason: "sin costo" });
  } else {
    const b = input.suggested;
    const { gainAmount, marginOnPrice, markupOnCost } = gainAndMargin(b.finalPrice, input.effectiveCost);
    const deltaSign = b.marginDelta >= 0 ? "+" : "";
    const basisParts = [`${b.targetMarginPercent}% meta`, `${deltaSign}${b.marginDelta}% por ${b.abcXyzClass}`];
    let basis = `${basisParts.join(" ")} = ${b.marginAfterAdjustment}%`;
    if (b.flooredByPolicy) basis += " (mínimo de la política aplicado)";
    if (b.operatingExpensePerUnit > 0) basis += ` · gastos C$ ${b.operatingExpensePerUnit.toFixed(2)}/u`;
    if (b.minProfitAmount > 0) basis += ` · ganancia mínima C$ ${b.minProfitAmount.toFixed(2)}`;
    if (b.rawPrice !== b.finalPrice) basis += ` · redondeo C$ ${b.rawPrice.toFixed(2)} → C$ ${b.finalPrice.toFixed(2)}`;
    refs.push({ method: "SUGGESTED", label: "Sugerido por política", price: b.finalPrice, gainAmount, marginOnPrice, markupOnCost, basis, available: true });
  }

  // REALIZED_MARGIN — "como lo venís vendiendo": costo / (1 − margenRealizado).
  {
    const enoughData = input.realizedMargin !== null
      && input.realizedMargin.lineCount >= MIN_LINES_FOR_REALIZED_MARGIN
      && input.realizedMargin.distinctSaleDays >= MIN_DAYS_FOR_REALIZED_MARGIN;
    if (!enoughData || input.effectiveCost === null) {
      refs.push({ method: "REALIZED_MARGIN", label: "Como lo venís vendiendo", price: null, gainAmount: null, marginOnPrice: null, markupOnCost: null, basis: null, available: false, reason: "sin ventas suficientes" });
    } else {
      const raw = priceForMargin(input.effectiveCost, input.realizedMargin!.marginPct);
      if (raw === null) {
        refs.push({ method: "REALIZED_MARGIN", label: "Como lo venís vendiendo", price: null, gainAmount: null, marginOnPrice: null, markupOnCost: null, basis: null, available: false, reason: "margen realizado no permite calcular un precio" });
      } else {
        const price = rounded(raw, input.roundingRule);
        const { gainAmount, marginOnPrice, markupOnCost } = gainAndMargin(price, input.effectiveCost);
        refs.push({ method: "REALIZED_MARGIN", label: "Como lo venís vendiendo", price, gainAmount, marginOnPrice, markupOnCost, basis: `margen realizado ${round2(input.realizedMargin!.marginPct)}% en ${input.realizedMargin!.lineCount} ventas`, available: true });
      }
    }
  }

  // KEEP_GAIN_AMOUNT — misma ganancia en C$: precioActual + (costoActual − costoAnterior).
  {
    const available = input.priorCost !== null && input.currentPrice !== null && input.effectiveCost !== null;
    if (!available) {
      refs.push({ method: "KEEP_GAIN_AMOUNT", label: "Misma ganancia en C$", price: null, gainAmount: null, marginOnPrice: null, markupOnCost: null, basis: null, available: false, reason: "sin costo anterior confiable" });
    } else {
      const raw = input.currentPrice! + (input.effectiveCost! - input.priorCost!);
      const price = rounded(Math.max(raw, 0), input.roundingRule);
      const { gainAmount, marginOnPrice, markupOnCost } = gainAndMargin(price, input.effectiveCost);
      refs.push({ method: "KEEP_GAIN_AMOUNT", label: "Misma ganancia en C$", price, gainAmount, marginOnPrice, markupOnCost, basis: `costo anterior C$ ${input.priorCost!.toFixed(2)}`, available: true });
    }
  }

  // KEEP_MARGIN_PCT — mismo % que tenía: costoActual / (1 − margenAnterior), margen con precio/costo ANTERIORES.
  {
    const available = input.priorCost !== null && input.currentPrice !== null && input.effectiveCost !== null && input.priorCost! > 0 && input.currentPrice! > 0;
    if (!available) {
      refs.push({ method: "KEEP_MARGIN_PCT", label: "Mismo % que tenía", price: null, gainAmount: null, marginOnPrice: null, markupOnCost: null, basis: null, available: false, reason: "sin costo anterior confiable" });
    } else {
      const marginAnterior = ((input.currentPrice! - input.priorCost!) / input.currentPrice!) * 100;
      const raw = priceForMargin(input.effectiveCost!, marginAnterior);
      if (raw === null) {
        refs.push({ method: "KEEP_MARGIN_PCT", label: "Mismo % que tenía", price: null, gainAmount: null, marginOnPrice: null, markupOnCost: null, basis: null, available: false, reason: "sin costo anterior confiable" });
      } else {
        const price = rounded(raw, input.roundingRule);
        const { gainAmount, marginOnPrice, markupOnCost } = gainAndMargin(price, input.effectiveCost);
        refs.push({ method: "KEEP_MARGIN_PCT", label: "Mismo % que tenía", price, gainAmount, marginOnPrice, markupOnCost, basis: `margen anterior ${round2(marginAnterior)}%`, available: true });
      }
    }
  }

  // POLICY_MIN — el mínimo de la política: costo / (1 − min/100).
  {
    if (input.effectiveCost === null) {
      refs.push({ method: "POLICY_MIN", label: "Mínimo de la política", price: null, gainAmount: null, marginOnPrice: null, markupOnCost: null, basis: null, available: false, reason: "sin costo" });
    } else {
      const raw = priceForMargin(input.effectiveCost, input.policyMinMarginPercent);
      if (raw === null) {
        refs.push({ method: "POLICY_MIN", label: "Mínimo de la política", price: null, gainAmount: null, marginOnPrice: null, markupOnCost: null, basis: null, available: false, reason: "margen mínimo no permite calcular un precio" });
      } else {
        const price = rounded(raw, input.roundingRule);
        const { gainAmount, marginOnPrice, markupOnCost } = gainAndMargin(price, input.effectiveCost);
        refs.push({ method: "POLICY_MIN", label: "Mínimo de la política", price, gainAmount, marginOnPrice, markupOnCost, basis: `mínimo ${input.policyMinMarginPercent}%`, available: true });
      }
    }
  }

  // OTHER_BRANCH — una referencia POR CADA otra sucursal con precio propio, con el margen que daría ACÁ.
  for (const branch of input.otherBranches) {
    const { gainAmount, marginOnPrice, markupOnCost } = gainAndMargin(branch.price, input.effectiveCost);
    refs.push({ method: "OTHER_BRANCH", label: `Igual que ${branch.branchName}`, price: branch.price, gainAmount, marginOnPrice, markupOnCost, basis: `precio en ${branch.branchName}`, available: true });
  }

  return refs;
}
