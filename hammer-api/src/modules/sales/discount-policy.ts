import { Prisma } from "@prisma/client";

export type DiscountPolicyValidationInput = {
  role: string | null | undefined;
  discountPercent: Prisma.Decimal;
  effectiveCost: Prisma.Decimal | null;
  netUnitPriceAfterDiscount: Prisma.Decimal;
  overrideReason?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  categoryMaxDiscountPercent?: Prisma.Decimal | number | null;
  commercialRecommendedMaxDiscountPercent?: Prisma.Decimal | number | null;
  combinedClass?: string | null;
  riskLevel?: string | null;
};

export type DiscountPolicyValidationResult = {
  allowed: boolean;
  code?: "DISCOUNT_LIMIT_EXCEEDED" | "BELOW_COST_NOT_ALLOWED" | "BELOW_COST_OVERRIDE_REASON_REQUIRED";
  message?: string;
  warnings: string[];
};

const ZERO = new Prisma.Decimal(0);

export function getMaxDiscountPercentForRole(role: string | null | undefined): number {
  switch ((role ?? "").toUpperCase()) {
    case "MASTER":
    case "OWNER":
    case "SYSTEM_ADMIN":
      return 100;
    case "ADMIN":
    case "BRANCH_ADMIN":
      return 15;
    case "CAJA":
    case "CASHIER":
    case "VENDEDOR":
    case "SALES":
    default:
      return 5;
  }
}

export function canOverrideBelowCost(role: string | null | undefined): boolean {
  const normalized = (role ?? "").toUpperCase();
  return normalized === "MASTER" || normalized === "OWNER" || normalized === "SYSTEM_ADMIN" || normalized === "ADMIN" || normalized === "BRANCH_ADMIN";
}

function canOverrideCommercialRisk(role: string | null | undefined): boolean {
  const normalized = (role ?? "").toUpperCase();
  return normalized === "MASTER" || normalized === "OWNER" || normalized === "SYSTEM_ADMIN";
}

export function validateDiscountForRole(input: DiscountPolicyValidationInput): DiscountPolicyValidationResult {
  const warnings: string[] = [];
  const roleMaxDiscount = new Prisma.Decimal(getMaxDiscountPercentForRole(input.role));
  const categoryMaxDiscount = input.categoryMaxDiscountPercent === null || input.categoryMaxDiscountPercent === undefined
    ? null
    : new Prisma.Decimal(input.categoryMaxDiscountPercent);
  const commercialMaxDiscount = input.commercialRecommendedMaxDiscountPercent === null || input.commercialRecommendedMaxDiscountPercent === undefined
    ? null
    : new Prisma.Decimal(input.commercialRecommendedMaxDiscountPercent);
  const hasCategoryLimit = Boolean(categoryMaxDiscount && categoryMaxDiscount.gt(ZERO));
  const hasCommercialLimit = Boolean(commercialMaxDiscount && commercialMaxDiscount.gte(ZERO));
  let effectiveMaxDiscount = hasCategoryLimit && categoryMaxDiscount!.lt(roleMaxDiscount) ? categoryMaxDiscount! : roleMaxDiscount;
  if (hasCommercialLimit && commercialMaxDiscount!.lt(effectiveMaxDiscount)) effectiveMaxDiscount = commercialMaxDiscount!;

  if (input.combinedClass === "CZ" && input.discountPercent.gt(ZERO) && !canOverrideCommercialRisk(input.role)) {
    return {
      allowed: false,
      code: "DISCOUNT_LIMIT_EXCEEDED",
      message: "El descuento supera el limite recomendado por rotacion/riesgo del producto.",
      warnings: [
        ...warnings,
        "Clase CZ: descuento recomendado 0%.",
        `Riesgo: ${input.riskLevel ?? "CRITICAL"}.`,
      ],
    };
  }

  if (input.combinedClass === "CZ" && input.discountPercent.gt(ZERO) && canOverrideCommercialRisk(input.role) && !input.overrideReason?.trim()) {
    return {
      allowed: false,
      code: "DISCOUNT_LIMIT_EXCEEDED",
      message: "Se requiere una razon de override para descontar un producto CZ.",
      warnings: [
        ...warnings,
        "Clase CZ: descuento recomendado 0%.",
      ],
    };
  }

  if (input.discountPercent.gt(effectiveMaxDiscount)) {
    const blockedByRole = input.discountPercent.gt(roleMaxDiscount);
    const blockedByCategory = Boolean(hasCategoryLimit && input.discountPercent.gt(categoryMaxDiscount!));
    const blockedByCommercial = Boolean(hasCommercialLimit && input.discountPercent.gt(commercialMaxDiscount!));
    const source = blockedByCommercial
      ? "rotacion/riesgo del producto"
      : blockedByRole && blockedByCategory ? "rol y categoria" : blockedByCategory ? "categoria" : "rol";
    return {
      allowed: false,
      code: "DISCOUNT_LIMIT_EXCEEDED",
      message: `Este descuento supera el limite permitido por ${source}.`,
      warnings: [
        ...warnings,
        `Limite rol: ${roleMaxDiscount.toString()}%.`,
        ...(hasCategoryLimit ? [`Limite categoria: ${categoryMaxDiscount!.toString()}%.`] : []),
        ...(hasCommercialLimit ? [`Limite ABC-XYZ: ${commercialMaxDiscount!.toString()}%.`] : []),
      ],
    };
  }

  if (input.effectiveCost && input.effectiveCost.gt(ZERO) && input.netUnitPriceAfterDiscount.lt(input.effectiveCost)) {
    if (!canOverrideBelowCost(input.role)) {
      return {
        allowed: false,
        code: "BELOW_COST_NOT_ALLOWED",
        message: "El precio neto queda por debajo del costo efectivo del producto.",
        warnings,
      };
    }

    if (!input.overrideReason?.trim()) {
      return {
        allowed: false,
        code: "BELOW_COST_OVERRIDE_REASON_REQUIRED",
        message: "Se requiere una razon de override para vender por debajo del costo efectivo.",
        warnings,
      };
    }

    warnings.push("Venta bajo costo permitida con razon de override.");
  }

  return { allowed: true, warnings };
}
