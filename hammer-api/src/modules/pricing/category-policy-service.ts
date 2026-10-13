import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { UpsertCategoryPricingPolicyInput } from "@/modules/pricing/validators";
import { logAuditEvent } from "@/modules/audit/service";

export type CategoryPricingPolicyDto = {
  id: string | null;
  branchId: string;
  categoryId: string;
  categoryCode?: string;
  categoryName?: string;
  minMarginPercent: number;
  targetMarginPercent: number;
  minProfitAmount: number;
  maxDiscountPercent: number;
  estimatedMonthlyUnits: number;
  estimatedMonthlySalesValue: number | null;
  monthlyExpenseAllocation: number;
  stockPolicy: string;
  priceMode: string;
  roundingRule: string;
  isActive: boolean;
  notes: string | null;
  isVirtualDefault: boolean;
};

/**
 * Parte C.3 (prompt-completo-pendientes-2026-10.md) — "nada fijo en el
 * código": ÚLTIMO recurso, solo cuando la sucursal ni siquiera tiene
 * PricingConfig (nunca debería pasar en una sucursal real/configurada).
 * El default REAL que el dueño ve y puede editar es
 * PricingConfig.alertMinMarginPercent/targetMarginPercent — ver
 * getBranchPolicyDefaults(Batch) más abajo.
 */
export const FALLBACK_POLICY_DEFAULTS = {
  minMarginPercent: 15,
  targetMarginPercent: 30,
  minProfitAmount: 0,
  maxDiscountPercent: 0,
  estimatedMonthlyUnits: 1,
  estimatedMonthlySalesValue: null as number | null,
  monthlyExpenseAllocation: 0,
  stockPolicy: "NORMAL",
  priceMode: "CATEGORY",
  roundingRule: "NEAREST_1",
  isActive: true,
  notes: null as string | null,
};

export type BranchPolicyDefaults = { minMarginPercent: number; targetMarginPercent: number };

/** Defaults de UNA sucursal, desde su PricingConfig — el dueño los edita en Precios → Configuración. */
export async function getBranchPolicyDefaults(db: Prisma.TransactionClient | typeof prisma, branchId: string): Promise<BranchPolicyDefaults> {
  const config = await db.pricingConfig.findUnique({ where: { branchId }, select: { alertMinMarginPercent: true, targetMarginPercent: true } });
  return {
    minMarginPercent: config ? Number(config.alertMinMarginPercent) : FALLBACK_POLICY_DEFAULTS.minMarginPercent,
    targetMarginPercent: config ? Number(config.targetMarginPercent) : FALLBACK_POLICY_DEFAULTS.targetMarginPercent,
  };
}

/** Mismo default, para VARIAS sucursales en una sola consulta (hot loops del detector). */
export async function getBranchPolicyDefaultsBatch(db: typeof prisma, branchIds: string[]): Promise<Map<string, BranchPolicyDefaults>> {
  const result = new Map<string, BranchPolicyDefaults>();
  if (branchIds.length === 0) return result;
  const configs = await db.pricingConfig.findMany({
    where: { branchId: { in: [...new Set(branchIds)] } },
    select: { branchId: true, alertMinMarginPercent: true, targetMarginPercent: true },
  });
  for (const config of configs) {
    result.set(config.branchId, { minMarginPercent: Number(config.alertMinMarginPercent), targetMarginPercent: Number(config.targetMarginPercent) });
  }
  return result;
}

function decimal(value: number | null | undefined) {
  return value === null || value === undefined ? null : new Prisma.Decimal(value);
}

function toDto(policy: any, category?: { code: string; name: string }, branchId?: string, categoryId?: string, branchDefaults?: BranchPolicyDefaults): CategoryPricingPolicyDto {
  const minMarginDefault = branchDefaults?.minMarginPercent ?? FALLBACK_POLICY_DEFAULTS.minMarginPercent;
  const targetMarginDefault = branchDefaults?.targetMarginPercent ?? FALLBACK_POLICY_DEFAULTS.targetMarginPercent;
  return {
    id: policy?.id ?? null,
    branchId: policy?.branchId ?? branchId!,
    categoryId: policy?.categoryId ?? categoryId!,
    categoryCode: category?.code ?? policy?.category?.code,
    categoryName: category?.name ?? policy?.category?.name,
    minMarginPercent: Number(policy?.minMarginPercent ?? minMarginDefault),
    targetMarginPercent: Number(policy?.targetMarginPercent ?? targetMarginDefault),
    minProfitAmount: Number(policy?.minProfitAmount ?? FALLBACK_POLICY_DEFAULTS.minProfitAmount),
    maxDiscountPercent: Number(policy?.maxDiscountPercent ?? FALLBACK_POLICY_DEFAULTS.maxDiscountPercent),
    estimatedMonthlyUnits: Number(policy?.estimatedMonthlyUnits ?? FALLBACK_POLICY_DEFAULTS.estimatedMonthlyUnits),
    estimatedMonthlySalesValue: policy?.estimatedMonthlySalesValue == null ? null : Number(policy.estimatedMonthlySalesValue),
    monthlyExpenseAllocation: Number(policy?.monthlyExpenseAllocation ?? FALLBACK_POLICY_DEFAULTS.monthlyExpenseAllocation),
    stockPolicy: policy?.stockPolicy ?? FALLBACK_POLICY_DEFAULTS.stockPolicy,
    priceMode: policy?.priceMode ?? FALLBACK_POLICY_DEFAULTS.priceMode,
    roundingRule: policy?.roundingRule ?? FALLBACK_POLICY_DEFAULTS.roundingRule,
    isActive: policy?.isActive ?? FALLBACK_POLICY_DEFAULTS.isActive,
    notes: policy?.notes ?? FALLBACK_POLICY_DEFAULTS.notes,
    isVirtualDefault: !policy?.id,
  };
}

export async function listBranchCategoryPricingPolicies({ branchId }: { branchId: string }) {
  const [categories, policies, branchDefaults] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.branchCategoryPricingPolicy.findMany({ where: { branchId }, include: { category: { select: { code: true, name: true } } } }),
    getBranchPolicyDefaults(prisma, branchId),
  ]);
  const byCategoryId = new Map(policies.map((policy) => [policy.categoryId, policy]));
  return {
    policies: categories.map((category) => toDto(byCategoryId.get(category.id), category, branchId, category.id, branchDefaults)),
  };
}

export async function getCategoryPricingPolicy(
  input: { branchId: string; categoryId: string },
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const [policy, branchDefaults] = await Promise.all([
    db.branchCategoryPricingPolicy.findUnique({
      where: { branchId_categoryId: { branchId: input.branchId, categoryId: input.categoryId } },
      include: { category: { select: { code: true, name: true } } },
    }),
    getBranchPolicyDefaults(db, input.branchId),
  ]);
  if (policy) return toDto(policy, undefined, undefined, undefined, branchDefaults);
  const category = await db.category.findUnique({ where: { id: input.categoryId }, select: { code: true, name: true } });
  return toDto(null, category ?? undefined, input.branchId, input.categoryId, branchDefaults);
}

export async function upsertCategoryPricingPolicy(input: UpsertCategoryPricingPolicyInput, actorUserId: string) {
  const previous = await prisma.branchCategoryPricingPolicy.findUnique({
    where: { branchId_categoryId: { branchId: input.branchId, categoryId: input.categoryId } },
  });
  const data = {
    minMarginPercent: new Prisma.Decimal(input.minMarginPercent),
    targetMarginPercent: new Prisma.Decimal(input.targetMarginPercent),
    minProfitAmount: new Prisma.Decimal(input.minProfitAmount),
    maxDiscountPercent: new Prisma.Decimal(input.maxDiscountPercent),
    estimatedMonthlyUnits: new Prisma.Decimal(Math.max(input.estimatedMonthlyUnits, 1)),
    estimatedMonthlySalesValue: decimal(input.estimatedMonthlySalesValue),
    monthlyExpenseAllocation: new Prisma.Decimal(input.monthlyExpenseAllocation),
    stockPolicy: input.stockPolicy,
    priceMode: input.priceMode,
    roundingRule: input.roundingRule,
    notes: input.notes ?? null,
    isActive: input.isActive ?? true,
  };
  const policy = await prisma.branchCategoryPricingPolicy.upsert({
    where: { branchId_categoryId: { branchId: input.branchId, categoryId: input.categoryId } },
    create: { branchId: input.branchId, categoryId: input.categoryId, ...data },
    update: data,
    include: { category: { select: { code: true, name: true } } },
  });

  await logAuditEvent({
    actorUserId,
    branchId: input.branchId,
    module: "pricing",
    action: previous ? "CATEGORY_POLICY_UPDATED" : "CATEGORY_POLICY_CREATED",
    entityType: "BranchCategoryPricingPolicy",
    entityId: policy.id,
    metadataJson: {
      branchId: input.branchId,
      categoryId: input.categoryId,
      previousValues: previous ? toDto(previous) : null,
      newValues: toDto(policy),
    },
  });

  return toDto(policy);
}

export async function createDefaultPoliciesForBranch(input: { branchId: string; actorUserId: string }) {
  const categories = await prisma.category.findMany({ where: { isActive: true }, select: { id: true } });
  const existing = await prisma.branchCategoryPricingPolicy.findMany({
    where: { branchId: input.branchId },
    select: { categoryId: true },
  });
  const existingIds = new Set(existing.map((item) => item.categoryId));
  let created = 0;
  for (const category of categories) {
    if (existingIds.has(category.id)) continue;
    await prisma.branchCategoryPricingPolicy.create({ data: { branchId: input.branchId, categoryId: category.id } });
    created += 1;
  }
  const skipped = categories.length - created;
  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "pricing",
    action: "CATEGORY_POLICY_BOOTSTRAP",
    entityType: "Branch",
    entityId: input.branchId,
    metadataJson: { created, skipped },
  });
  return { created, skipped };
}

export async function resolvePolicyForProduct(
  input: { branchId: string; productId: string },
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const product = await db.product.findUniqueOrThrow({
    where: { id: input.productId },
    select: { categoryId: true, category: { select: { code: true, name: true } } },
  });
  const policy = await getCategoryPricingPolicy({ branchId: input.branchId, categoryId: product.categoryId }, db);
  return {
    categoryId: product.categoryId,
    categoryName: product.category.name,
    categoryPolicy: policy,
  };
}

/**
 * Batch version of resolvePolicyForProduct — resolves category pricing policy
 * for many (branchId, productId) pairs in 2 queries instead of ~2 per pair.
 * Used by hot loops (Brain detectors, replenishment, commercial-intelligence).
 */
export async function resolvePolicyForProductBatch(
  items: Array<{ branchId: string; productId: string }>,
  db: typeof prisma = prisma,
): Promise<Map<string, { categoryId: string; categoryName: string; categoryPolicy: CategoryPricingPolicyDto }>> {
  const result = new Map<string, { categoryId: string; categoryName: string; categoryPolicy: CategoryPricingPolicyDto }>();
  if (items.length === 0) return result;

  const productIds = [...new Set(items.map((item) => item.productId))];
  const branchIds = [...new Set(items.map((item) => item.branchId))];

  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, categoryId: true, category: { select: { code: true, name: true } } },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const categoryIds = [...new Set(products.map((product) => product.categoryId))];

  const [policies, branchDefaultsByBranch] = await Promise.all([
    db.branchCategoryPricingPolicy.findMany({
      where: { branchId: { in: branchIds }, categoryId: { in: categoryIds } },
      include: { category: { select: { code: true, name: true } } },
    }),
    getBranchPolicyDefaultsBatch(db, branchIds),
  ]);
  const policyByKey = new Map(policies.map((policy) => [`${policy.branchId}:${policy.categoryId}`, policy]));

  for (const { branchId, productId } of items) {
    const key = `${branchId}:${productId}`;
    if (result.has(key)) continue;
    const product = productById.get(productId);
    if (!product) continue;

    const policy = policyByKey.get(`${branchId}:${product.categoryId}`);
    result.set(key, {
      categoryId: product.categoryId,
      categoryName: product.category.name,
      categoryPolicy: toDto(policy, product.category, branchId, product.categoryId, branchDefaultsByBranch.get(branchId)),
    });
  }

  return result;
}
