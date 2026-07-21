import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getReplenishmentRecommendations, type ReplenishmentSignal } from "./replenishment-service";
import { createTransfer } from "@/modules/transfers/service";
import { createPurchaseOrder, getLastPurchaseUnitCostBeforeTax } from "@/modules/purchase-orders/service";
import { logAuditEvent } from "@/modules/audit/service";

const SIGNAL_SOURCE_TO_DRAFT_SOURCE: Record<string, string> = {
  TRANSFER: "OTHER_BRANCH",
  PRODUCTION: "PRODUCTION",
  PURCHASE: "SUPPLIER",
};
const SIGNAL_SEVERITY_TO_CRITICALITY: Record<string, string> = {
  CRITICAL: "CRITICAL",
  LOW: "LOW",
  COVERED: "OBSERVE",
  NO_DEMAND: "NORMAL",
};

/* ─── Types ─── */

export type DraftSummary = {
  id: string;
  branchId: string;
  branchName: string;
  status: string;
  includePreventive: boolean;
  categoryId: string | null;
  notes: string | null;
  generatedAt: string;
  createdAt: string;
  approvedAt: string | null;
  convertedAt: string | null;
  createdBy: { id: string; fullName: string; username: string };
  approvedBy: { id: string; fullName: string; username: string } | null;
  itemCount: number;
  criticalCount: number;
  lowCount: number;
  preventiveCount: number;
  pendingCount: number;
};

type CreateDraftInput = {
  branchId: string;
  includePreventive: boolean;
  categoryId?: string;
  notes?: string;
  actorUserId: string;
};

type UpdateItemInput = {
  finalQuantity?: number | null;
  status?: string;
  notes?: string;
  recommendedSource?: string;
};

type ConvertResult = {
  transfersCreated: string[];
  purchaseOrdersCreated: string[];
  productionOrdersRequested: string[];
  skipped: string[];
  warnings: string[];
};

/* ─── Helpers ─── */

function toNum(d: Prisma.Decimal | null | undefined): number {
  return d === null || d === undefined ? 0 : Number(d);
}

const INCLUDE_DRAFT = {
  branch: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, fullName: true, username: true } },
  approvedBy: { select: { id: true, fullName: true, username: true } },
  items: true,
} as const;

/* ─── List drafts ─── */

export async function listReplenishmentDrafts(params: {
  branchId?: string;
  status?: string;
  limit?: number;
}) {
  const where: Prisma.ReplenishmentDraftWhereInput = {
    ...(params.branchId ? { branchId: params.branchId } : {}),
    ...(params.status ? { status: params.status as any } : {}),
  };

  const drafts = await prisma.replenishmentDraft.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 50,
    include: {
      branch: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, fullName: true, username: true } },
      approvedBy: { select: { id: true, fullName: true, username: true } },
      _count: { select: { items: true } },
    },
  });

  return drafts.map((d) => ({
    id: d.id,
    branchId: d.branchId,
    branchCode: d.branch.code,
    branchName: d.branch.name,
    status: d.status,
    includePreventive: d.includePreventive,
    includeSensitive: d.includeSensitive,
    categoryId: d.categoryId,
    notes: d.notes,
    generatedAt: d.generatedAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
    approvedAt: d.approvedAt?.toISOString() ?? null,
    convertedAt: d.convertedAt?.toISOString() ?? null,
    createdBy: d.createdBy,
    approvedBy: d.approvedBy ?? null,
    itemCount: d._count.items,
  }));
}

/* ─── Get single draft ─── */

export async function getReplenishmentDraft(draftId: string) {
  const draft = await prisma.replenishmentDraft.findUniqueOrThrow({
    where: { id: draftId },
    include: INCLUDE_DRAFT,
  });

  const items = draft.items;
  return {
    id: draft.id,
    branchId: draft.branchId,
    branchName: draft.branch.name,
    branchCode: draft.branch.code,
    status: draft.status,
    includePreventive: draft.includePreventive,
    includeSensitive: draft.includeSensitive,
    categoryId: draft.categoryId,
    notes: draft.notes,
    generatedAt: draft.generatedAt.toISOString(),
    createdAt: draft.createdAt.toISOString(),
    approvedAt: draft.approvedAt?.toISOString() ?? null,
    convertedAt: draft.convertedAt?.toISOString() ?? null,
    createdBy: draft.createdBy,
    approvedBy: draft.approvedBy ?? null,
    summary: {
      total: items.length,
      criticalCount: items.filter((i) => i.criticality === "CRITICAL").length,
      lowCount: items.filter((i) => i.criticality === "LOW").length,
      preventiveCount: items.filter((i) => i.criticality === "PREVENTIVE").length,
      pendingCount: items.filter((i) => i.status === "PENDING_REVIEW").length,
      approvedCount: items.filter((i) => i.status === "APPROVED").length,
      ignoredCount: items.filter((i) => i.status === "IGNORED").length,
      manualReviewCount: items.filter((i) => i.requiresManualReview).length,
    },
    items: items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      branchId: item.branchId,
      currentStock: toNum(item.currentStock),
      salesLast30Days: toNum(item.salesLast30Days),
      salesLast60Days: toNum(item.salesLast60Days),
      salesLast90Days: toNum(item.salesLast90Days),
      lastSoldAt: item.lastSoldAt?.toISOString() ?? null,
      criticality: item.criticality,
      recommendedSource: item.recommendedSource,
      sourceBranchId: item.sourceBranchId,
      suggestedQuantity: toNum(item.suggestedQuantity),
      finalQuantity: item.finalQuantity !== null ? toNum(item.finalQuantity) : null,
      reason: item.reason,
      warnings: Array.isArray(item.warnings) ? item.warnings : [],
      requiresManualReview: item.requiresManualReview,
      status: item.status,
      linkedTransferId: item.linkedTransferId,
      linkedPurchaseOrderId: item.linkedPurchaseOrderId,
      notes: item.notes,
      updatedAt: item.updatedAt.toISOString(),
    })),
  };
}

/* ─── Create draft from recommendations ─── */

export async function createReplenishmentDraft(input: CreateDraftInput) {
  const branch = await prisma.branch.findUniqueOrThrow({
    where: { id: input.branchId },
    select: { id: true, name: true, code: true },
  });

  // Get live recommendations (snapshot at creation time)
  const { recommendations } = await getReplenishmentRecommendations({
    branchId: input.branchId,
    categoryId: input.categoryId,
    includeTransferOpportunities: true,
  });

  // Filter which recommendations enter the draft
  // NOTE: timber products (isTimber=true) are excluded from recommendations before reaching here
  const eligible = recommendations.filter((rec) => {
    const { criticality } = rec;

    // Never include DO_NOT_RECOMMEND or products with no history and no stock
    if (criticality === "DO_NOT_RECOMMEND") return false;
    if (rec.stockOnHand === 0 && rec.unitsSoldLast90Days === 0) return false;

    // Always include CRITICAL and LOW
    if (criticality === "CRITICAL" || criticality === "LOW") return true;

    // Optionally include PREVENTIVE
    if (criticality === "PREVENTIVE" && input.includePreventive) return true;

    return false;
  });

  if (eligible.length === 0) {
    throw new Error("No hay productos elegibles para el borrador con los criterios seleccionados.");
  }

  const SOURCE_MAP: Record<string, string> = {
    CENTRAL: "CENTRAL",
    OTHER_BRANCH: "OTHER_BRANCH",
    SUPPLIER: "SUPPLIER",
    PRODUCTION: "PRODUCTION",
    DO_NOT_REPLENISH: "DO_NOT_REPLENISH",
    MANUAL_REVIEW: "MANUAL_REVIEW",
  };

  const CRITICALITY_MAP: Record<string, string> = {
    CRITICAL: "CRITICAL",
    LOW: "LOW",
    PREVENTIVE: "PREVENTIVE",
    OBSERVE: "OBSERVE",
    NORMAL: "NORMAL",
    DO_NOT_RECOMMEND: "DO_NOT_RECOMMEND",
    MANUAL_REVIEW: "MANUAL_REVIEW",
  };

  const draft = await prisma.replenishmentDraft.create({
    data: {
      branchId: input.branchId,
      createdByUserId: input.actorUserId,
      status: "DRAFT",
      includePreventive: input.includePreventive,
      includeSensitive: false,
      categoryId: input.categoryId ?? null,
      notes: input.notes ?? null,
      items: {
        create: eligible.map((rec) => {
          const srcOption = rec.sourceOptions.find(
            (o) => o.type === "OTHER_BRANCH" || o.type === "CENTRAL"
          );
          const src = SOURCE_MAP[rec.recommendedSource] ?? "SUPPLIER";
          const requiresManualReview = rec.recommendedSource === "MANUAL_REVIEW";

          return {
            productId: rec.productId,
            branchId: input.branchId,
            categoryId: rec.categoryId ?? null,
            categoryName: rec.categoryName ?? null,
            productName: rec.name,
            sku: rec.sku,
            currentStock: rec.stockOnHand,
            salesLast30Days: rec.unitsSoldLast30Days,
            salesLast60Days: rec.unitsSoldLast60Days,
            salesLast90Days: rec.unitsSoldLast90Days,
            lastSoldAt: rec.lastSoldAt ? new Date(rec.lastSoldAt) : null,
            criticality: (CRITICALITY_MAP[rec.criticality] ?? "NORMAL") as any,
            recommendedSource: src as any,
            sourceBranchId: srcOption?.branchId ?? null,
            suggestedQuantity: rec.suggestedOrderQty,
            finalQuantity: requiresManualReview ? null : rec.suggestedOrderQty,
            reason: rec.message,
            warnings: rec.warnings as any,
            isSensitive: false,
            requiresManualReview,
            status: requiresManualReview ? "MANUAL_REVIEW_REQUIRED" : "PENDING_REVIEW",
          };
        }),
      },
    },
    include: INCLUDE_DRAFT,
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "inventory",
    action: "REPLENISHMENT_DRAFT_CREATED",
    entityType: "ReplenishmentDraft",
    entityId: draft.id,
    metadataJson: {
      branchName: branch.name,
      itemCount: eligible.length,
      includePreventive: input.includePreventive,
    },
  });

  return getReplenishmentDraft(draft.id);
}

/* ─── Update draft item ─── */

export async function updateReplenishmentDraftItem(
  draftId: string,
  itemId: string,
  input: UpdateItemInput,
  actorUserId: string
) {
  const item = await prisma.replenishmentDraftItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { id: true, draftId: true, status: true, requiresManualReview: true },
  });

  if (item.draftId !== draftId) {
    throw new Error("El item no pertenece al borrador indicado.");
  }

  // Determine new status
  let newStatus = input.status ?? item.status;
  if (
    input.finalQuantity !== undefined &&
    input.finalQuantity !== null &&
    !input.status
  ) {
    newStatus = "QUANTITY_EDITED";
  }

  // Validate quantity
  if (
    input.finalQuantity !== undefined &&
    input.finalQuantity !== null &&
    Number(input.finalQuantity) < 0
  ) {
    throw new Error("La cantidad final no puede ser negativa.");
  }

  const updated = await prisma.replenishmentDraftItem.update({
    where: { id: itemId },
    data: {
      ...(input.finalQuantity !== undefined
        ? { finalQuantity: input.finalQuantity === null ? null : new Prisma.Decimal(input.finalQuantity) }
        : {}),
      ...(input.status ? { status: input.status as any } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.recommendedSource ? { recommendedSource: input.recommendedSource as any } : {}),
      ...(newStatus !== item.status ? { status: newStatus as any } : {}),
    },
  });

  await logAuditEvent({
    actorUserId,
    module: "inventory",
    action: "REPLENISHMENT_DRAFT_ITEM_UPDATED",
    entityType: "ReplenishmentDraftItem",
    entityId: updated.id,
    metadataJson: {
      draftId,
      previousStatus: item.status,
      newStatus: updated.status,
      finalQuantity: input.finalQuantity ?? null,
      notes: input.notes ?? null,
    },
  });

  return updated;
}

/* ─── Approve draft ─── */

export async function approveReplenishmentDraft(draftId: string, actorUserId: string) {
  const draft = await prisma.replenishmentDraft.findUniqueOrThrow({
    where: { id: draftId },
    include: { items: true },
  });

  if (draft.status !== "DRAFT" && draft.status !== "REVIEWED") {
    throw new Error(`No se puede aprobar un borrador con estado ${draft.status}.`);
  }

  // Validate: no items with PENDING_REVIEW and null finalQuantity
  const invalidItems = draft.items.filter(
    (i) =>
      i.status === "PENDING_REVIEW" &&
      i.finalQuantity === null &&
      !i.requiresManualReview
  );
  if (invalidItems.length > 0) {
    throw new Error(
      `Hay ${invalidItems.length} producto(s) sin cantidad final. Edítalos o ignóralos antes de aprobar.`
    );
  }

  // Items with finalQuantity <= 0 and not ignored must be flagged
  const zeroItems = draft.items.filter(
    (i) =>
      i.status !== "IGNORED" &&
      i.finalQuantity !== null &&
      Number(i.finalQuantity) <= 0
  );
  if (zeroItems.length > 0) {
    throw new Error(
      `Hay ${zeroItems.length} producto(s) con cantidad final 0 o negativa. Ignóralos o corrígelos.`
    );
  }

  const approved = await prisma.replenishmentDraft.update({
    where: { id: draftId },
    data: {
      status: "APPROVED",
      approvedByUserId: actorUserId,
      approvedAt: new Date(),
    },
  });

  await logAuditEvent({
    actorUserId,
    branchId: draft.branchId,
    module: "inventory",
    action: "REPLENISHMENT_DRAFT_APPROVED",
    entityType: "ReplenishmentDraft",
    entityId: draftId,
    metadataJson: { approvedItems: draft.items.filter((i) => i.status !== "IGNORED").length },
  });

  return approved;
}

/* ─── Convert draft to actions ─── */

export async function convertReplenishmentDraft(
  draftId: string,
  actorUserId: string
): Promise<ConvertResult> {
  const draft = await prisma.replenishmentDraft.findUniqueOrThrow({
    where: { id: draftId },
    include: { items: true },
  });

  if (draft.status !== "APPROVED") {
    throw new Error("Solo se pueden convertir borradores con estado APPROVED.");
  }
  if (draft.convertedAt) {
    throw new Error("Este borrador ya fue convertido. No se puede convertir dos veces.");
  }

  const result: ConvertResult = {
    transfersCreated: [],
    purchaseOrdersCreated: [],
    productionOrdersRequested: [],
    skipped: [],
    warnings: [],
  };

  // Get central branch for CENTRAL source
  const centralBranch = await prisma.branch.findFirst({
    where: { isDefaultSupplier: true, isActive: true },
    select: { id: true, name: true },
  });

  // Group actionable items by source type
  const actionableItems = draft.items.filter(
    (i) =>
      i.status !== "IGNORED" &&
      !i.requiresManualReview &&
      i.finalQuantity !== null &&
      Number(i.finalQuantity) > 0 &&
      i.linkedTransferId === null &&
      i.linkedPurchaseOrderId === null
  );

  // Group CENTRAL and OTHER_BRANCH by sourceBranchId → create one transfer per source branch
  const transferGroups = new Map<string, typeof actionableItems>();
  for (const item of actionableItems) {
    if (item.recommendedSource !== "CENTRAL" && item.recommendedSource !== "OTHER_BRANCH") continue;
    const fromBranchId = item.recommendedSource === "CENTRAL"
      ? (centralBranch?.id ?? item.sourceBranchId ?? "")
      : (item.sourceBranchId ?? centralBranch?.id ?? "");
    if (!fromBranchId) {
      result.warnings.push(`${item.productName}: sin sucursal origen — omitido.`);
      result.skipped.push(item.id);
      continue;
    }
    if (!transferGroups.has(fromBranchId)) transferGroups.set(fromBranchId, []);
    transferGroups.get(fromBranchId)!.push(item);
  }

  // Create transfers
  for (const [fromBranchId, items] of transferGroups) {
    try {
      const transfer = await createTransfer({
        userId: actorUserId,
        fromBranchId,
        toBranchId: draft.branchId,
        notes: `[Reposición v2] Plan ${draftId}`,
        lines: items.map((i) => ({
          productId: i.productId,
          quantity: Number(i.finalQuantity),
        })),
      });

      // Link items to transfer
      await prisma.replenishmentDraftItem.updateMany({
        where: { id: { in: items.map((i) => i.id) } },
        data: { linkedTransferId: transfer.id, status: "TRANSFER_CREATED" },
      });

      result.transfersCreated.push(transfer.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      result.warnings.push(`Error creando traslado desde sucursal ${fromBranchId}: ${msg}`);
      for (const item of items) result.skipped.push(item.id);
    }
  }

  // Group SUPPLIER items by real supplierId → un pedido de compra POR PROVEEDOR,
  // con el último costo de compra sin IVA (nunca C$0, nunca WAC-con-IVA duplicado).
  const supplierItems = actionableItems.filter((i) => i.recommendedSource === "SUPPLIER");
  const supplierGroups = new Map<string, typeof supplierItems>();
  for (const item of supplierItems) {
    const key = item.supplierId ?? "__sin_proveedor__";
    if (!supplierGroups.has(key)) supplierGroups.set(key, []);
    supplierGroups.get(key)!.push(item);
  }

  for (const [supplierKey, items] of supplierGroups) {
    try {
      const lines = [];
      for (const item of items) {
        const unitCostBeforeTax = item.estimatedUnitCost !== null
          ? Number(item.estimatedUnitCost)
          : (await getLastPurchaseUnitCostBeforeTax(prisma, item.productId)).unitCostBeforeTax;
        if (unitCostBeforeTax <= 0) {
          result.warnings.push(`${item.productName}: sin costo de compra conocido — revisar antes de aprobar el pedido.`);
        }
        lines.push({ productId: item.productId, quantity: Number(item.finalQuantity), unitCostBeforeTax });
      }

      const po = await createPurchaseOrder({
        userId: actorUserId,
        branchId: draft.branchId,
        supplierId: supplierKey === "__sin_proveedor__" ? undefined : supplierKey,
        notes: `[Reposición v2] Plan ${draftId}`,
        purchaseTaxTreatment: "INCLUDE_IN_COST",
        lines,
      });

      await prisma.replenishmentDraftItem.updateMany({
        where: { id: { in: items.map((i) => i.id) } },
        data: { linkedPurchaseOrderId: po.id, status: "PURCHASE_REQUEST_CREATED" },
      });

      result.purchaseOrdersCreated.push(po.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      result.warnings.push(`Error creando compra para proveedor ${supplierKey}: ${msg}`);
      for (const item of items) result.skipped.push(item.id);
    }
  }

  // PRODUCTION items — just flag them (no automatic production order creation)
  const productionItems = actionableItems.filter((i) => i.recommendedSource === "PRODUCTION");
  for (const item of productionItems) {
    await prisma.replenishmentDraftItem.update({
      where: { id: item.id },
      data: { status: "PRODUCTION_ORDER_CREATED" },
    });
    result.productionOrdersRequested.push(item.id);
  }

  // Items requiring manual review — skip
  const manualItems = draft.items.filter((i) => i.requiresManualReview && i.status !== "IGNORED");
  if (manualItems.length > 0) {
    result.warnings.push(
      `${manualItems.length} producto(s) sensible(s) requieren revisión manual y no fueron convertidos.`
    );
  }

  // Determine final draft status
  const allConverted =
    result.skipped.length === 0 &&
    draft.items.filter((i) => i.status !== "IGNORED" && !i.requiresManualReview).length ===
      result.transfersCreated.length + result.purchaseOrdersCreated.length + result.productionOrdersRequested.length;

  const newStatus = allConverted
    ? result.transfersCreated.length > 0
      ? "CONVERTED_TO_TRANSFER"
      : result.purchaseOrdersCreated.length > 0
      ? "CONVERTED_TO_PURCHASE_REQUEST"
      : "APPROVED"
    : "PARTIALLY_APPROVED";

  await prisma.replenishmentDraft.update({
    where: { id: draftId },
    data: { status: newStatus as any, convertedAt: new Date() },
  });

  await logAuditEvent({
    actorUserId,
    branchId: draft.branchId,
    module: "inventory",
    action: "REPLENISHMENT_DRAFT_CONVERTED",
    entityType: "ReplenishmentDraft",
    entityId: draftId,
    metadataJson: {
      transfersCreated: result.transfersCreated,
      purchaseOrdersCreated: result.purchaseOrdersCreated,
      productionOrdersRequested: result.productionOrdersRequested,
      skipped: result.skipped.length,
      warnings: result.warnings,
    },
  });

  return result;
}

/* ════════════════════════════════════════════════════════════════
 * Reposición v2 — Plan (Fase 1.4): agregar señales / item manual / quitar / descartar
 * ════════════════════════════════════════════════════════════════ */

async function getOrCreateActiveDraft(branchId: string, actorUserId: string) {
  const existing = await prisma.replenishmentDraft.findFirst({
    where: { branchId, status: { in: ["DRAFT", "REVIEWED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  return prisma.replenishmentDraft.create({
    data: { branchId, createdByUserId: actorUserId, status: "DRAFT", includePreventive: false, includeSensitive: false },
  });
}

/** Agrega una o más señales (de getReplenishmentSignals) al plan activo de la sucursal — lo crea si no existe. */
export async function addSignalsToPlan(branchId: string, signals: ReplenishmentSignal[], actorUserId: string) {
  if (signals.length === 0) throw new Error("No hay señales para agregar.");
  const draft = await getOrCreateActiveDraft(branchId, actorUserId);

  const existingItems = await prisma.replenishmentDraftItem.findMany({
    where: { draftId: draft.id, productId: { in: signals.map((s) => s.productId) } },
    select: { id: true, productId: true },
  });
  const existingItemIdByProductId = new Map(existingItems.map((i) => [i.productId, i.id]));

  let addedCount = 0;
  for (const signal of signals) {
    const primarySource = signal.sources[0] as ReplenishmentSignal["sources"][number] | undefined;
    const quantity = primarySource?.quantity ?? signal.netNeed;
    const estimatedUnitCost = primarySource?.type === "PURCHASE"
      ? (await getLastPurchaseUnitCostBeforeTax(prisma, signal.productId)).unitCostBeforeTax
      : null;

    const data = {
      productId: signal.productId,
      branchId,
      productName: signal.name,
      sku: signal.sku,
      currentStock: new Prisma.Decimal(signal.stockOnHand),
      salesLast30Days: new Prisma.Decimal(0),
      salesLast60Days: new Prisma.Decimal(0),
      salesLast90Days: new Prisma.Decimal(0),
      criticality: (SIGNAL_SEVERITY_TO_CRITICALITY[signal.severity] ?? "NORMAL") as any,
      recommendedSource: (primarySource ? SIGNAL_SOURCE_TO_DRAFT_SOURCE[primarySource.type] : "DO_NOT_REPLENISH") as any,
      sourceBranchId: primarySource?.type === "TRANSFER" ? primarySource.branchId ?? null : null,
      supplierId: primarySource?.type === "PURCHASE" ? primarySource.supplierId ?? null : null,
      estimatedUnitCost: estimatedUnitCost === null ? null : new Prisma.Decimal(estimatedUnitCost),
      suggestedQuantity: new Prisma.Decimal(quantity),
      finalQuantity: new Prisma.Decimal(quantity),
      reason: signal.message,
      warnings: signal.warnings as unknown as Prisma.InputJsonValue,
      status: "PENDING_REVIEW" as const,
    };

    const existingItemId = existingItemIdByProductId.get(signal.productId);
    if (existingItemId) {
      await prisma.replenishmentDraftItem.update({ where: { id: existingItemId }, data });
    } else {
      await prisma.replenishmentDraftItem.create({ data: { ...data, draftId: draft.id } });
      addedCount++;
    }
  }

  await logAuditEvent({
    actorUserId,
    branchId,
    module: "inventory",
    action: "REPLENISHMENT_SIGNALS_ADDED_TO_PLAN",
    entityType: "ReplenishmentDraft",
    entityId: draft.id,
    metadataJson: { signalsCount: signals.length, added: addedCount },
  });

  return getReplenishmentDraft(draft.id);
}

/** Agrega un producto al plan a mano (no viene de una señal). */
export async function addManualItemToPlan(input: {
  branchId: string;
  productId: string;
  quantity: number;
  source: "TRANSFER" | "PRODUCTION" | "PURCHASE";
  sourceBranchId?: string;
  supplierId?: string;
  actorUserId: string;
}) {
  if (input.quantity <= 0) throw new Error("La cantidad debe ser mayor que 0.");
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: input.productId },
    select: { id: true, sku: true, name: true, categoryId: true, category: { select: { name: true } } },
  });
  const draft = await getOrCreateActiveDraft(input.branchId, input.actorUserId);
  const estimatedUnitCost = input.source === "PURCHASE"
    ? (await getLastPurchaseUnitCostBeforeTax(prisma, input.productId)).unitCostBeforeTax
    : null;

  const item = await prisma.replenishmentDraftItem.create({
    data: {
      draftId: draft.id,
      productId: product.id,
      branchId: input.branchId,
      categoryId: product.categoryId,
      categoryName: product.category.name,
      productName: product.name,
      sku: product.sku,
      currentStock: new Prisma.Decimal(0),
      criticality: "NORMAL",
      recommendedSource: SIGNAL_SOURCE_TO_DRAFT_SOURCE[input.source] as any,
      sourceBranchId: input.source === "TRANSFER" ? input.sourceBranchId ?? null : null,
      supplierId: input.source === "PURCHASE" ? input.supplierId ?? null : null,
      estimatedUnitCost: estimatedUnitCost === null ? null : new Prisma.Decimal(estimatedUnitCost),
      suggestedQuantity: new Prisma.Decimal(input.quantity),
      finalQuantity: new Prisma.Decimal(input.quantity),
      reason: "Agregado manualmente al plan.",
      warnings: [],
      addedManually: true,
      status: "QUANTITY_EDITED",
    },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "inventory",
    action: "REPLENISHMENT_MANUAL_ITEM_ADDED",
    entityType: "ReplenishmentDraftItem",
    entityId: item.id,
    metadataJson: { productId: product.id, quantity: input.quantity, source: input.source },
  });

  return getReplenishmentDraft(draft.id);
}

/** Quita una línea del plan por completo (distinto de marcarla IGNORED). Solo mientras el plan no esté aprobado/convertido. */
export async function removeReplenishmentDraftItem(draftId: string, itemId: string, actorUserId: string) {
  const item = await prisma.replenishmentDraftItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { id: true, draftId: true, draft: { select: { status: true, branchId: true } } },
  });
  if (item.draftId !== draftId) throw new Error("El item no pertenece al borrador indicado.");
  if (item.draft.status !== "DRAFT" && item.draft.status !== "REVIEWED") {
    throw new Error(`No se puede modificar un plan con estado ${item.draft.status}.`);
  }

  await prisma.replenishmentDraftItem.delete({ where: { id: itemId } });

  await logAuditEvent({
    actorUserId,
    branchId: item.draft.branchId,
    module: "inventory",
    action: "REPLENISHMENT_DRAFT_ITEM_REMOVED",
    entityType: "ReplenishmentDraftItem",
    entityId: itemId,
    metadataJson: { draftId },
  });

  return { ok: true };
}

/** Descarta un plan completo (no convertido). */
export async function discardReplenishmentDraft(draftId: string, actorUserId: string) {
  const draft = await prisma.replenishmentDraft.findUniqueOrThrow({ where: { id: draftId } });
  const nonDiscardable: string[] = ["CONVERTED_TO_TRANSFER", "CONVERTED_TO_PURCHASE_REQUEST", "CONVERTED_TO_PRODUCTION_ORDER"];
  if (nonDiscardable.includes(draft.status)) {
    throw new Error("No se puede descartar un plan que ya fue convertido.");
  }

  const updated = await prisma.replenishmentDraft.update({
    where: { id: draftId },
    data: { status: "CANCELLED" },
  });

  await logAuditEvent({
    actorUserId,
    branchId: draft.branchId,
    module: "inventory",
    action: "REPLENISHMENT_DRAFT_DISCARDED",
    entityType: "ReplenishmentDraft",
    entityId: draftId,
    metadataJson: {},
  });

  return updated;
}
