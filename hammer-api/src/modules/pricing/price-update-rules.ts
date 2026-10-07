import { Prisma } from "@prisma/client";
import { applyRounding, type RoundingRule } from "@/modules/pricing/calculator";
import { computeMarginPercent, computePercentChange } from "@/modules/pricing/price-math";

/**
 * prompt-carga-precios.md Fase 1 — funciones puras del motor de reglas
 * masivas y la vista previa. Sin DB: reciben la foto ya tomada (costSnapshot/
 * currentPriceSnapshot/priceSourceSnapshot) y devuelven una decisión. El
 * servicio (price-update-batch-service.ts) es la única parte con I/O.
 */

export type BulkPriceRule =
  | { kind: "PERCENT_ON_PRICE"; percent: number; rounding?: RoundingRule }
  | { kind: "MARKUP_ON_COST"; percent: number; rounding?: RoundingRule }
  | { kind: "TARGET_MARGIN"; percent: number; rounding?: RoundingRule }
  | { kind: "FIXED"; price: number; rounding?: RoundingRule };

export type BulkPriceLineInput = {
  costSnapshot: number | null;
  currentPriceSnapshot: number | null;
};

export type ComputeBulkPriceResult =
  | { price: Prisma.Decimal; warning: null }
  | { price: null; warning: string };

/**
 * Calcula el precio nuevo para UNA línea según la regla elegida. Nunca
 * lanza — sin costo/precio vigente para la regla que lo necesita, devuelve
 * `price: null` + un aviso en vez de inventar un número ("sin precio y con
 * aviso", doc Fase 1).
 */
export function computeBulkPrice(line: BulkPriceLineInput, rule: BulkPriceRule): ComputeBulkPriceResult {
  const rounding = rule.rounding ?? "NONE";

  switch (rule.kind) {
    case "FIXED": {
      if (!(rule.price > 0)) {
        return { price: null, warning: "El precio fijo debe ser mayor que 0." };
      }
      return { price: applyRounding(new Prisma.Decimal(rule.price), rounding), warning: null };
    }
    case "PERCENT_ON_PRICE": {
      if (line.currentPriceSnapshot == null || line.currentPriceSnapshot <= 0) {
        return { price: null, warning: "Sin precio vigente para aplicar el porcentaje." };
      }
      const price = line.currentPriceSnapshot * (1 + rule.percent / 100);
      return { price: applyRounding(new Prisma.Decimal(price), rounding), warning: null };
    }
    case "MARKUP_ON_COST": {
      if (line.costSnapshot == null || line.costSnapshot <= 0) {
        return { price: null, warning: "Sin costo para calcular el markup." };
      }
      const price = line.costSnapshot * (1 + rule.percent / 100);
      return { price: applyRounding(new Prisma.Decimal(price), rounding), warning: null };
    }
    case "TARGET_MARGIN": {
      if (line.costSnapshot == null || line.costSnapshot <= 0) {
        return { price: null, warning: "Sin costo para calcular el margen objetivo." };
      }
      if (rule.percent >= 100) {
        return { price: null, warning: "El margen objetivo debe ser menor a 100%." };
      }
      const price = line.costSnapshot / (1 - rule.percent / 100);
      return { price: applyRounding(new Prisma.Decimal(price), rounding), warning: null };
    }
    default: {
      // Exhaustividad — si se agrega un kind nuevo sin actualizar acá, tsc lo marca.
      const _never: never = rule;
      return _never;
    }
  }
}

export type ClassifyLineInput = {
  newPrice: number | null;
  costSnapshot: number | null;
  currentPriceSnapshot: number | null;
  /** "BRANCH" | "STANDARD" | "FUSION_DERIVED" | "MISSING" — ver current-prices-service.ts */
  priceSourceSnapshot: string;
  productIsActive: boolean;
};

export type ClassifyLinePolicy = {
  /** null para destino GENERAL — BranchCategoryPricingPolicy es por sucursal, no hay con qué comparar. */
  minMarginPercent: number | null;
};

export type ClassifyLineResult =
  | { status: "SKIPPED"; reason: string }
  | { status: "BLOCKED"; reason: string }
  | { status: "PENDING"; warnings: string[]; marginNew: number | null; changePercent: number | null };

const MAX_PRICE_CHANGE_PERCENT = 30;

/**
 * Clasifica UNA línea para la vista previa. El orden importa: inactivo y
 * fusión bloquean ANTES que la validación numérica (son motivos de negocio,
 * no de cálculo) — bajo el costo se revisa al final porque necesita
 * costSnapshot, que las otras ramas no tocan.
 */
export function classifyLine(line: ClassifyLineInput, policy: ClassifyLinePolicy): ClassifyLineResult {
  // Inactivo/fusión son hechos ESTÁTICOS del producto — ciertos con o sin
  // precio nuevo todavía, así que se chequean ANTES del "sin precio" para
  // que createDraft pueda detectarlos de una (doc: "la deja en PENDING, o
  // en BLOCKED si ya se sabe") sin esperar a que alguien escriba un precio.
  if (!line.productIsActive) {
    return { status: "BLOCKED", reason: "El producto está inactivo." };
  }
  if (line.priceSourceSnapshot === "FUSION_DERIVED") {
    return { status: "BLOCKED", reason: "El precio se deriva del producto canónico de fusión; edítalo ahí." };
  }
  if (line.newPrice == null) {
    return { status: "SKIPPED", reason: "Sin precio nuevo." };
  }
  if (line.newPrice <= 0) {
    return { status: "BLOCKED", reason: "El precio nuevo debe ser mayor que 0." };
  }
  if (line.costSnapshot != null && line.costSnapshot > 0 && line.newPrice < line.costSnapshot) {
    return {
      status: "BLOCKED",
      reason: `El precio nuevo (${line.newPrice}) es menor que el costo efectivo (${line.costSnapshot}).`,
    };
  }

  const warnings: string[] = [];
  const marginNew = computeMarginPercent(line.costSnapshot, line.newPrice);
  const changePercent = computePercentChange(line.currentPriceSnapshot, line.newPrice);

  if (line.costSnapshot == null || line.costSnapshot <= 0) {
    warnings.push("Producto sin costo: no se puede medir el margen.");
  } else if (policy.minMarginPercent != null && marginNew != null && marginNew < policy.minMarginPercent) {
    warnings.push(`Margen nuevo (${marginNew.toFixed(1)}%) por debajo del mínimo de la categoría (${policy.minMarginPercent}%).`);
  }

  if (changePercent != null && Math.abs(changePercent) > MAX_PRICE_CHANGE_PERCENT) {
    warnings.push(`Cambio de ${changePercent.toFixed(1)}% contra el precio vigente.`);
  }

  return { status: "PENDING", warnings, marginNew, changePercent };
}
