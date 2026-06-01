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

const DEFAULT_POLICY = {
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

function decimal(value: number | null | undefined) {
  return value === null || value === undefined ? null : new Prisma.Decimal(value);
}

function toDto(policy: any, category?: { code: string; name: string }, branchId?: string, categoryId?: string): CategoryPricingPolicyDto {
  return {
    id: policy?.id ?? null,
    branchId: policy?.branchId ?? branchId!,
    categoryId: policy?.categoryId ?? categoryId!,
    categoryCode: category?.code ?? policy?.category?.code,
    categoryName: category?.name ?? policy?.category?.name,
    minMarginPercent: Number(policy?.minMarginPercent ?? DEFAULT_POLICY.minMarginPercent),
    targetMarginPercent: Number(policy?.targetMarginPercent ?? DEFAULT_POLICY.targetMarginPercent),
    minProfitAmount: Number(policy?.minProfitAmount ?? DEFAULT_POLICY.minProfitAmount),
    maxDiscountPercent: Number(policy?.maxDiscountPercent ?? DEFAULT_POLICY.maxDiscountPercent),
    estimatedMonthlyUnits: Number(policy?.estimatedMonthlyUnits ?? DEFAULT_POLICY.estimatedMonthlyUnits),
    estimatedMonthlySalesValue: policy?.estimatedMonthlySalesValue == null ? null : Number(policy.estimatedMonthlySalesValue),
    monthlyExpenseAllocation: Number(policy?.monthlyExpenseAllocation ?? DEFAULT_POLICY.monthlyExpenseAllocation),
    stockPolicy: policy?.stockPolicy ?? DEFAULT_POLICY.stockPolicy,
    priceMode: policy?.priceMode ?? DEFAULT_POLICY.priceMode,
    roundingRule: policy?.roundingRule ?? DEFAULT_POLICY.roundingRule,
    isActive: policy?.isActive ?? DEFAULT_POLICY.isActive,
    notes: policy?.notes ?? DEFAULT_POLICY.notes,
    isVirtualDefault: !policy?.id,
  };
}

export async function listBranchCategoryPricingPolicies({ branchId }: { branchId: string }) {
  const [categories, policies] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.branchCategoryPricingPolicy.findMany({ where: { branchId }, include: { category: { select: { code: true, name: true } } } }),
  ]);
  const byCategoryId = new Map(policies.map((policy) => [policy.categoryId, policy]));
  return {
    policies: categories.map((category) => toDto(byCategoryId.get(category.id), category, branchId, category.id)),
  };
}

export async function getCategoryPricingPolicy(input: { branchId: string; categoryId: string }) {
  const policy = await prisma.branchCategoryPricingPolicy.findUnique({
    where: { branchId_categoryId: { branchId: input.branchId, categoryId: input.categoryId } },
    include: { category: { select: { code: true, name: true } } },
  });
  if (policy) return toDto(policy);
  const category = await prisma.category.findUnique({ where: { id: input.categoryId }, select: { code: true, name: true } });
  return toDto(null, category ?? undefined, input.branchId, input.categoryId);
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

export async function resolvePolicyForProduct(input: { branchId: string; productId: string }) {
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: input.productId },
    select: { categoryId: true, category: { select: { code: true, name: true } } },
  });
  const policy = await getCategoryPricingPolicy({ branchId: input.branchId, categoryId: product.categoryId });
  return {
    categoryId: product.categoryId,
    categoryName: product.category.name,
    categoryPolicy: policy,
  };
}
