import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";

type DiscountType = "PERCENTAGE" | "FIXED_AMOUNT";

function discountModel() {
  return (prisma as any).discount;
}

export type CreateDiscountInput = {
  name: string;
  description?: string;
  type: DiscountType;
  value: number;
  productIds?: string[];
  abcCategories?: string[];
  xyzCategories?: string[];
  startDate?: string | null;
  endDate?: string | null;
  active?: boolean;
  branchId?: string | null;
  createdByUserId: string;
};

export type UpdateDiscountInput = Partial<Omit<CreateDiscountInput, "createdByUserId">>;

export async function listDiscounts(params?: { active?: boolean }) {
  const where: Record<string, unknown> = {};
  if (params?.active !== undefined) where.active = params.active;
  return discountModel().findMany({
    where,
    include: { createdBy: { select: { id: true, username: true, fullName: true } }, branch: { select: { id: true, code: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getDiscount(id: string) {
  const d = await discountModel().findUnique({
    where: { id },
    include: { createdBy: { select: { id: true, username: true, fullName: true } }, branch: { select: { id: true, code: true, name: true } } },
  });
  if (!d) throw new Error("NOT_FOUND");
  return d;
}

export async function createDiscount(input: CreateDiscountInput) {
  // Input validation
  if (!input.name?.trim()) throw new Error("INVALID_INPUT: El nombre del descuento es requerido");
  if (!input.type) throw new Error("INVALID_INPUT: El tipo de descuento es requerido");
  if (input.type !== "PERCENTAGE" && input.type !== "FIXED_AMOUNT") {
    throw new Error("INVALID_INPUT: Tipo de descuento inválido. Debe ser PERCENTAGE o FIXED_AMOUNT");
  }
  if (typeof input.value !== "number" || input.value <= 0) {
    throw new Error("INVALID_INPUT: El valor del descuento debe ser un número positivo");
  }
  if (input.type === "PERCENTAGE" && input.value > 100) {
    throw new Error("INVALID_INPUT: El porcentaje de descuento no puede ser mayor a 100%");
  }
  if (!input.createdByUserId) throw new Error("INVALID_INPUT: createdByUserId es requerido");
  // Validate date range
  if (input.startDate && input.endDate) {
    const start = new Date(input.startDate);
    const end = new Date(input.endDate);
    if (end < start) throw new Error("INVALID_INPUT: La fecha de fin no puede ser anterior a la fecha de inicio");
  }

  const d = await discountModel().create({
    data: {
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      value: input.value,
      productIds: input.productIds?.join(",") ?? null,
      abcCategories: input.abcCategories?.join(",") ?? null,
      xyzCategories: input.xyzCategories?.join(",") ?? null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      active: input.active ?? true,
      branchId: input.branchId ?? null,
      createdByUserId: input.createdByUserId,
    },
  });
  await logAuditEvent({
    actorUserId: input.createdByUserId,
    module: "discounts",
    action: "DISCOUNT_CREATED",
    entityType: "Discount",
    entityId: d.id,
    metadataJson: { name: d.name, type: d.type, value: Number(d.value) },
  });
  return d;
}

export async function updateDiscount(id: string, input: UpdateDiscountInput, actorUserId: string) {
  const existing = await discountModel().findUnique({ where: { id } });
  if (!existing) throw new Error("NOT_FOUND");

  // Validate updated fields
  if (input.name !== undefined && !input.name?.trim()) {
    throw new Error("INVALID_INPUT: El nombre del descuento no puede estar vacío");
  }
  if (input.type !== undefined && input.type !== "PERCENTAGE" && input.type !== "FIXED_AMOUNT") {
    throw new Error("INVALID_INPUT: Tipo de descuento inválido");
  }
  if (input.value !== undefined) {
    if (typeof input.value !== "number" || input.value <= 0) {
      throw new Error("INVALID_INPUT: El valor del descuento debe ser un número positivo");
    }
    const effectiveType = input.type ?? existing.type;
    if (effectiveType === "PERCENTAGE" && input.value > 100) {
      throw new Error("INVALID_INPUT: El porcentaje de descuento no puede ser mayor a 100%");
    }
  }
  // Validate date range
  const effectiveStart = input.startDate !== undefined ? input.startDate : existing.startDate?.toISOString() ?? null;
  const effectiveEnd = input.endDate !== undefined ? input.endDate : existing.endDate?.toISOString() ?? null;
  if (effectiveStart && effectiveEnd) {
    if (new Date(effectiveEnd) < new Date(effectiveStart)) {
      throw new Error("INVALID_INPUT: La fecha de fin no puede ser anterior a la fecha de inicio");
    }
  }

  const d = await discountModel().update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description ?? null }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.value !== undefined && { value: input.value }),
      ...(input.productIds !== undefined && { productIds: input.productIds?.join(",") ?? null }),
      ...(input.abcCategories !== undefined && { abcCategories: input.abcCategories?.join(",") ?? null }),
      ...(input.xyzCategories !== undefined && { xyzCategories: input.xyzCategories?.join(",") ?? null }),
      ...(input.startDate !== undefined && { startDate: input.startDate ? new Date(input.startDate) : null }),
      ...(input.endDate !== undefined && { endDate: input.endDate ? new Date(input.endDate) : null }),
      ...(input.active !== undefined && { active: input.active }),
      ...(input.branchId !== undefined && { branchId: input.branchId ?? null }),
    },
  });
  await logAuditEvent({
    actorUserId,
    module: "discounts",
    action: "DISCOUNT_UPDATED",
    entityType: "Discount",
    entityId: d.id,
    metadataJson: { changes: input },
  });
  return d;
}

export async function deleteDiscount(id: string, actorUserId: string) {
  const existing = await discountModel().findUnique({ where: { id } });
  if (!existing) throw new Error("NOT_FOUND");
  await discountModel().delete({ where: { id } });
  await logAuditEvent({
    actorUserId,
    module: "discounts",
    action: "DISCOUNT_DELETED",
    entityType: "Discount",
    entityId: id,
    metadataJson: { name: existing.name },
  });
}

/**
 * Get all currently active discounts applicable for a branch.
 * Used by POS to auto-apply discounts.
 */
export async function getActiveDiscountsForBranch(branchId: string) {
  const now = new Date();
  return discountModel().findMany({
    where: {
      active: true,
      OR: [
        { branchId: null },
        { branchId },
      ],
      AND: [
        { OR: [{ startDate: null }, { startDate: { lte: now } }] },
        { OR: [{ endDate: null }, { endDate: { gte: now } }] },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Calculate the discount amount for a product given its price.
 * Returns the discount amount (in C$) to subtract.
 */
export function calculateDiscountForProduct(
  product: { id: string; abcClassification?: string | null; xyzClassification?: string | null },
  unitPrice: number,
  discounts: Array<{
    type: string;
    value: unknown;
    productIds: string | null;
    abcCategories: string | null;
    xyzCategories: string | null;
  }>,
): number {
  let totalDiscount = 0;
  for (const disc of discounts) {
    const matchesProduct = !disc.productIds || disc.productIds.split(",").includes(product.id);
    const matchesAbc = !disc.abcCategories || (product.abcClassification && disc.abcCategories.split(",").includes(product.abcClassification));
    const matchesXyz = !disc.xyzCategories || (product.xyzClassification && disc.xyzCategories.split(",").includes(product.xyzClassification));

    // Product must match at least one active filter
    const hasProductFilter = !!disc.productIds;
    const hasAbcFilter = !!disc.abcCategories;
    const hasXyzFilter = !!disc.xyzCategories;
    const noFilters = !hasProductFilter && !hasAbcFilter && !hasXyzFilter;

    let applies = false;
    if (noFilters) {
      applies = true; // Applies to all products
    } else {
      // Must match at least one of the specified filters
      if (hasProductFilter && matchesProduct) applies = true;
      if (hasAbcFilter && matchesAbc) applies = true;
      if (hasXyzFilter && matchesXyz) applies = true;
    }

    if (applies) {
      const val = Number(disc.value);
      if (disc.type === "PERCENTAGE") {
        totalDiscount += unitPrice * (val / 100);
      } else {
        totalDiscount += val;
      }
    }
  }
  // Discount cannot exceed unit price
  return Math.min(totalDiscount, unitPrice);
}

export type DiscountSuggestion = {
  productId: string;
  sku: string;
  name: string;
  abcClassification: string;
  xyzClassification: string;
  recommendedType: "PERCENTAGE";
  recommendedValue: number;
  reason: string;
  status: "SUGGESTED_NOT_APPLIED";
};

export type DiscountSuggestionInsufficient = {
  productId: string;
  sku: string;
  name: string;
  reason: string;
};

function getBasePercentageFromAbcXyz(abc: string, xyz: string): number | null {
  const key = `${abc}${xyz}`;
  const map: Record<string, number | null> = {
    AX: null,
    AY: 5,
    AZ: 7,
    BX: 5,
    BY: 8,
    BZ: 10,
    CX: 8,
    CY: 12,
    CZ: 15,
  };
  return map[key] ?? null;
}

export async function listDiscountSuggestions(limit = 24): Promise<{
  generatedAt: string;
  suggested: DiscountSuggestion[];
  insufficientData: DiscountSuggestionInsufficient[];
}> {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      sku: true,
      name: true,
      abcClassification: true,
      xyzClassification: true,
      rotationIndex: true,
      averageDailySales: true,
      daysInStock: true,
    },
    orderBy: { name: "asc" },
  });

  const activeDiscounts = await discountModel().findMany({
    where: {
      active: true,
      OR: [
        { endDate: null },
        { endDate: { gte: new Date() } },
      ],
    },
    select: {
      productIds: true,
      abcCategories: true,
      xyzCategories: true,
    },
  });

  const alreadyCovered = (product: {
    id: string;
    abcClassification: string | null;
    xyzClassification: string | null;
  }) =>
    activeDiscounts.some((disc: { productIds: string | null; abcCategories: string | null; xyzCategories: string | null }) => {
      const productIds = disc.productIds ? disc.productIds.split(",") : [];
      const abcCategories = disc.abcCategories ? disc.abcCategories.split(",") : [];
      const xyzCategories = disc.xyzCategories ? disc.xyzCategories.split(",") : [];

      const hasAnyFilter = Boolean(disc.productIds || disc.abcCategories || disc.xyzCategories);
      if (!hasAnyFilter) return true;

      return (
        productIds.includes(product.id) ||
        (product.abcClassification ? abcCategories.includes(product.abcClassification) : false) ||
        (product.xyzClassification ? xyzCategories.includes(product.xyzClassification) : false)
      );
    });

  const suggested: DiscountSuggestion[] = [];
  const insufficientData: DiscountSuggestionInsufficient[] = [];

  for (const product of products) {
    const abc = product.abcClassification;
    const xyz = product.xyzClassification;

    if (!abc || !xyz) {
      insufficientData.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        reason: "Sin clasificación ABC-XYZ aplicada",
      });
      continue;
    }

    const basePercentage = getBasePercentageFromAbcXyz(abc, xyz);
    if (basePercentage === null) continue;
    if (alreadyCovered(product)) continue;

    const rotationIndex = Number(product.rotationIndex ?? 0);
    const averageDailySales = Number(product.averageDailySales ?? 0);
    const daysInStock = Number(product.daysInStock ?? 0);

    let recommendation = basePercentage;
    const reasonParts = [`Matriz ${abc}${xyz}`];

    if (rotationIndex > 0 && rotationIndex < 0.8) {
      recommendation += 2;
      reasonParts.push("rotación baja");
    }
    if (daysInStock > 120) {
      recommendation += 3;
      reasonParts.push("alto tiempo en inventario");
    } else if (daysInStock > 60) {
      recommendation += 2;
      reasonParts.push("inventario envejecido");
    }
    if (averageDailySales > 0 && averageDailySales < 1) {
      recommendation += 1;
      reasonParts.push("demanda diaria baja");
    }

    recommendation = Math.max(3, Math.min(20, recommendation));

    suggested.push({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      abcClassification: abc,
      xyzClassification: xyz,
      recommendedType: "PERCENTAGE",
      recommendedValue: recommendation,
      reason: reasonParts.join(" · "),
      status: "SUGGESTED_NOT_APPLIED",
    });
  }

  suggested.sort((a, b) => b.recommendedValue - a.recommendedValue);

  return {
    generatedAt: new Date().toISOString(),
    suggested: suggested.slice(0, limit),
    insufficientData: insufficientData.slice(0, limit),
  };
}
