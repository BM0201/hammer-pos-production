import { Prisma } from "@prisma/client";
import type {
  PriceUpdateBatchStatus,
  PriceUpdateBatchTarget,
  PriceUpdateBatchSource,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEffectiveProductPricingBatch, resolveCostChain } from "@/modules/catalog/effective-pricing";
import { isWacDrivesCostChainEnabled } from "@/modules/catalog/cost-chain-config";
import { resolvePolicyForProductBatch } from "@/modules/pricing/category-policy-service";
import { getProductStockConversionsBatch } from "@/modules/inventory/unit-conversion";
import {
  classifyLine,
  computeBulkPrice,
  type BulkPriceRule,
  type ClassifyLineResult,
} from "@/modules/pricing/price-update-rules";

/**
 * prompt-carga-precios.md Fase 1 — carga de trabajo de actualización masiva
 * de precios: borrador por producto×destino, vista previa con bloqueos/
 * avisos. La aplicación atómica vive en price-update-batch-apply-service.ts
 * (Fase 2) — este archivo es DRAFT only (crear/editar/previsualizar/
 * cancelar), nunca escribe un precio real.
 */

export type CreateDraftItem = { productId: string; newPrice?: number | null; trayDecisionId?: string | null };

export type CreateDraftInput = {
  target: PriceUpdateBatchTarget;
  branchIds: string[];
  reason: string;
  source: PriceUpdateBatchSource;
  items: CreateDraftItem[];
  actorUserId: string;
};

type LineSnapshot = {
  cost: number | null;
  price: number | null;
  /** "BRANCH" | "STANDARD" | "FUSION_DERIVED" | "MISSING" */
  priceSource: string;
  productIsActive: boolean;
};

/** CP-000001 — sequence es la fuente numérica (ver @@unique en el schema); code es solo el formateo. Mismo patrón que CreditNote (sales-returns/service.ts). */
async function nextBatchCodeTx(tx: Prisma.TransactionClient): Promise<{ code: string; sequence: number }> {
  const last = await tx.priceUpdateBatch.findFirst({ orderBy: { sequence: "desc" }, select: { sequence: true } });
  const sequence = (last?.sequence ?? 0) + 1;
  return { code: `CP-${String(sequence).padStart(6, "0")}`, sequence };
}

/**
 * Foto para líneas de destino BRANCHES — reusa el mismo motor que el POS/
 * Precios vigentes (getEffectiveProductPricingBatch), nunca una segunda
 * resolución de costo/precio.
 */
async function snapshotForBranch(
  tx: Prisma.TransactionClient,
  branchId: string,
  productIds: string[],
): Promise<Map<string, LineSnapshot>> {
  const result = new Map<string, LineSnapshot>();
  if (productIds.length === 0) return result;

  const pairs = productIds.map((productId) => ({ branchId, productId }));
  const [pricingByKey, products] = await Promise.all([
    getEffectiveProductPricingBatch(tx, pairs),
    tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, isActive: true } }),
  ]);
  const activeByProductId = new Map(products.map((p) => [p.id, p.isActive]));

  for (const productId of productIds) {
    const pricing = pricingByKey.get(`${branchId}:${productId}`);
    const rawPrice = pricing?.effectivePrice != null ? Number(pricing.effectivePrice) : 0;
    // Mismo criterio que current-prices-service.ts: <= 0 es "sin precio de
    // verdad" sin importar qué priceSource crudo haya devuelto effective-pricing.
    const priceSource = rawPrice <= 0 ? "MISSING" : (pricing?.priceSource ?? "MISSING");
    result.set(productId, {
      cost: pricing?.effectiveCost != null ? Number(pricing.effectiveCost) : null,
      price: priceSource === "MISSING" ? null : rawPrice,
      priceSource,
      productIsActive: activeByProductId.get(productId) ?? false,
    });
  }
  return result;
}

/**
 * Foto para líneas de destino GENERAL — standardSalePrice ES el precio
 * (no hay branchPrice que resolver); el costo usa el mismo resolveCostChain
 * exportado, sin branchCost/WAC (ninguno de los dos tiene sentido sin una
 * sucursal). Un miembro DERIVADO de fusión igual se marca FUSION_DERIVED
 * (classifyLine lo bloquea sin importar el destino, regla 3 del doc) — no
 * hace falta resolver el costo exacto del canónico para una línea que de
 * todas formas va a quedar BLOCKED.
 */
async function snapshotForGeneral(
  tx: Prisma.TransactionClient,
  productIds: string[],
): Promise<Map<string, LineSnapshot>> {
  const result = new Map<string, LineSnapshot>();
  if (productIds.length === 0) return result;

  const wacEnabled = await isWacDrivesCostChainEnabled(tx);
  const [products, conversionByProductId] = await Promise.all([
    tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, isActive: true, standardSalePrice: true, globalCost: true, averageCost: true, lastPurchaseCost: true },
    }),
    getProductStockConversionsBatch(tx, productIds),
  ]);

  for (const product of products) {
    const conversion = conversionByProductId.get(product.id);
    const isFusionMember = Boolean(conversion && !conversion.isCanonical);
    const price = Number(product.standardSalePrice);
    const { cost } = resolveCostChain(
      { branchCost: null, averageCost: product.averageCost, globalCost: product.globalCost, lastPurchaseCost: product.lastPurchaseCost, weightedAverageCost: null },
      wacEnabled,
    );
    result.set(product.id, {
      cost: cost != null ? Number(cost) : null,
      price: price > 0 ? price : null,
      priceSource: isFusionMember ? "FUSION_DERIVED" : price > 0 ? "STANDARD" : "MISSING",
      productIsActive: product.isActive,
    });
  }
  return result;
}

/** where.status IN [...] como CAS — mismo patrón que el resto de este módulo esta sesión: lock + relectura + transición condicional. */
async function assertDraftTx(tx: Prisma.TransactionClient, batchId: string) {
  await tx.$queryRaw`SELECT id FROM "PriceUpdateBatch" WHERE id = ${batchId} FOR UPDATE`;
  const batch = await tx.priceUpdateBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("NOT_FOUND");
  if (batch.status !== "DRAFT") throw new Error("ALREADY_PROCESSED");
  return batch;
}

/**
 * Expande producto × destino, toma la foto de cada línea (congelada hasta
 * que se edite newPrice) y la deja en PENDING, o en BLOCKED si ya se sabe
 * (producto inactivo / fusión derivada — hechos estáticos, no dependen del
 * precio todavía).
 */
export async function createDraftTx(
  tx: Prisma.TransactionClient,
  input: CreateDraftInput,
): Promise<{ batchId: string; code: string }> {
  const reason = input.reason?.trim() ?? "";
  if (!reason) throw new Error("VALIDATION_ERROR: la carga necesita un motivo.");
  if (input.target === "BRANCHES" && input.branchIds.length === 0) {
    throw new Error("VALIDATION_ERROR: elegí al menos una sucursal.");
  }
  if (input.items.length === 0) throw new Error("VALIDATION_ERROR: la carga necesita al menos un producto.");

  const branchIds = input.target === "GENERAL" ? [] : [...new Set(input.branchIds)];
  const productIds = [...new Set(input.items.map((i) => i.productId))];

  {
    const { code, sequence } = await nextBatchCodeTx(tx);

    const batch = await tx.priceUpdateBatch.create({
      data: {
        code,
        sequence,
        status: "DRAFT",
        target: input.target,
        branchIds,
        source: input.source,
        reason,
        createdByUserId: input.actorUserId,
      },
    });

    const snapshotsByBranch = new Map<string, Map<string, LineSnapshot>>();
    if (input.target === "GENERAL") {
      snapshotsByBranch.set("", await snapshotForGeneral(tx, productIds));
    } else {
      for (const branchId of branchIds) {
        snapshotsByBranch.set(branchId, await snapshotForBranch(tx, branchId, productIds));
      }
    }

    const destinations = input.target === "GENERAL" ? [null] : branchIds;
    for (const item of input.items) {
      for (const branchId of destinations) {
        const snapshot = snapshotsByBranch.get(branchId ?? "")?.get(item.productId);
        const newPrice = item.newPrice ?? null;
        const classified: ClassifyLineResult = classifyLine(
          {
            newPrice,
            costSnapshot: snapshot?.cost ?? null,
            currentPriceSnapshot: snapshot?.price ?? null,
            priceSourceSnapshot: snapshot?.priceSource ?? "MISSING",
            productIsActive: snapshot?.productIsActive ?? false,
          },
          { minMarginPercent: null },
        );

        await tx.priceUpdateLine.create({
          data: {
            batchId: batch.id,
            productId: item.productId,
            branchId,
            costSnapshot: snapshot?.cost != null ? new Prisma.Decimal(snapshot.cost) : null,
            currentPriceSnapshot: snapshot?.price != null ? new Prisma.Decimal(snapshot.price) : null,
            priceSourceSnapshot: snapshot?.priceSource ?? "MISSING",
            newPrice: newPrice != null ? new Prisma.Decimal(newPrice) : null,
            trayDecisionId: item.trayDecisionId ?? null,
            status: classified.status === "BLOCKED" ? "BLOCKED" : "PENDING",
            message: classified.status === "BLOCKED" ? classified.reason : null,
          },
        });
      }
    }

    return { batchId: batch.id, code: batch.code };
  }
}

export async function createDraft(input: CreateDraftInput): Promise<{ batchId: string; code: string }> {
  return prisma.$transaction((tx) => createDraftTx(tx, input));
}

export type UpdateLineInput = { lineId: string; newPrice: number | null };

/** Autoguardado de la planilla (PATCH /lines) — solo newPrice, solo en DRAFT. */
export async function updateLinesTx(
  tx: Prisma.TransactionClient,
  batchId: string,
  updates: UpdateLineInput[],
): Promise<{ updated: number }> {
  {
    await assertDraftTx(tx, batchId);

    let updated = 0;
    for (const update of updates) {
      const result = await tx.priceUpdateLine.updateMany({
        where: { id: update.lineId, batchId },
        data: { newPrice: update.newPrice != null ? new Prisma.Decimal(update.newPrice) : null },
      });
      updated += result.count;
    }
    return { updated };
  }
}

export async function updateLines(batchId: string, updates: UpdateLineInput[]): Promise<{ updated: number }> {
  return prisma.$transaction((tx) => updateLinesTx(tx, batchId, updates));
}

export async function addLinesTx(
  tx: Prisma.TransactionClient,
  batchId: string,
  items: CreateDraftItem[],
  actorUserId: string,
): Promise<{ added: number }> {
  {
    const batch = await assertDraftTx(tx, batchId);
    const branchIds = batch.target === "GENERAL" ? [] : batch.branchIds;
    const destinations = batch.target === "GENERAL" ? [null] : branchIds;
    const productIds = [...new Set(items.map((i) => i.productId))];

    const existing = await tx.priceUpdateLine.findMany({
      where: { batchId, productId: { in: productIds } },
      select: { productId: true, branchId: true },
    });
    const existingKeys = new Set(existing.map((l) => `${l.productId}:${l.branchId ?? ""}`));

    const snapshotsByBranch = new Map<string, Map<string, LineSnapshot>>();
    if (batch.target === "GENERAL") {
      snapshotsByBranch.set("", await snapshotForGeneral(tx, productIds));
    } else {
      for (const branchId of branchIds) {
        snapshotsByBranch.set(branchId, await snapshotForBranch(tx, branchId, productIds));
      }
    }

    let added = 0;
    for (const item of items) {
      for (const branchId of destinations) {
        const key = `${item.productId}:${branchId ?? ""}`;
        if (existingKeys.has(key)) continue; // ya está en la carga — no duplicar

        const snapshot = snapshotsByBranch.get(branchId ?? "")?.get(item.productId);
        const newPrice = item.newPrice ?? null;
        const classified = classifyLine(
          {
            newPrice,
            costSnapshot: snapshot?.cost ?? null,
            currentPriceSnapshot: snapshot?.price ?? null,
            priceSourceSnapshot: snapshot?.priceSource ?? "MISSING",
            productIsActive: snapshot?.productIsActive ?? false,
          },
          { minMarginPercent: null },
        );

        await tx.priceUpdateLine.create({
          data: {
            batchId,
            productId: item.productId,
            branchId,
            costSnapshot: snapshot?.cost != null ? new Prisma.Decimal(snapshot.cost) : null,
            currentPriceSnapshot: snapshot?.price != null ? new Prisma.Decimal(snapshot.price) : null,
            priceSourceSnapshot: snapshot?.priceSource ?? "MISSING",
            newPrice: newPrice != null ? new Prisma.Decimal(newPrice) : null,
            trayDecisionId: item.trayDecisionId ?? null,
            status: classified.status === "BLOCKED" ? "BLOCKED" : "PENDING",
            message: classified.status === "BLOCKED" ? classified.reason : null,
          },
        });
        added += 1;
      }
    }

    void actorUserId; // reservado para auditoría si hiciera falta más adelante
    return { added };
  }
}

export async function addLines(batchId: string, items: CreateDraftItem[], actorUserId: string): Promise<{ added: number }> {
  return prisma.$transaction((tx) => addLinesTx(tx, batchId, items, actorUserId));
}

export async function removeLinesTx(
  tx: Prisma.TransactionClient,
  batchId: string,
  lineIds: string[],
): Promise<{ removed: number }> {
  {
    await assertDraftTx(tx, batchId);
    const result = await tx.priceUpdateLine.deleteMany({ where: { batchId, id: { in: lineIds } } });
    return { removed: result.count };
  }
}

export async function removeLines(batchId: string, lineIds: string[]): Promise<{ removed: number }> {
  return prisma.$transaction((tx) => removeLinesTx(tx, batchId, lineIds));
}

/**
 * Aplica una regla masiva a las líneas seleccionadas (o a todas) — SOLO
 * cambia `newPrice` en el borrador, nunca aplica nada real. Una línea cuya
 * regla no pudo calcular precio (sin costo/sin precio vigente) se deja
 * como estaba, y se cuenta en `skipped` para que la pantalla avise.
 */
export async function applyBulkRuleTx(
  tx: Prisma.TransactionClient,
  batchId: string,
  target: { lineIds: string[] } | "ALL",
  rule: BulkPriceRule,
): Promise<{ updated: number; skipped: number }> {
  {
    await assertDraftTx(tx, batchId);

    const lines = await tx.priceUpdateLine.findMany({
      where: {
        batchId,
        status: { not: "BLOCKED" },
        ...(target === "ALL" ? {} : { id: { in: target.lineIds } }),
      },
      select: { id: true, costSnapshot: true, currentPriceSnapshot: true },
    });

    let updated = 0;
    let skipped = 0;
    for (const line of lines) {
      const computed = computeBulkPrice(
        {
          costSnapshot: line.costSnapshot != null ? Number(line.costSnapshot) : null,
          currentPriceSnapshot: line.currentPriceSnapshot != null ? Number(line.currentPriceSnapshot) : null,
        },
        rule,
      );
      if (computed.price == null) {
        skipped += 1;
        continue;
      }
      await tx.priceUpdateLine.update({ where: { id: line.id }, data: { newPrice: computed.price } });
      updated += 1;
    }

    return { updated, skipped };
  }
}

export async function applyBulkRule(
  batchId: string,
  target: { lineIds: string[] } | "ALL",
  rule: BulkPriceRule,
): Promise<{ updated: number; skipped: number }> {
  return prisma.$transaction((tx) => applyBulkRuleTx(tx, batchId, target, rule));
}

export type PreviewLine = {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  branchId: string | null;
  branchCode: string | null;
  costSnapshot: number | null;
  currentPriceSnapshot: number | null;
  priceSourceSnapshot: string;
  newPrice: number | null;
  status: "PENDING" | "APPLIED" | "CONFLICT" | "BLOCKED" | "SKIPPED";
  dbMessage: string | null;
  marginCurrent: number | null;
  marginNew: number | null;
  changePercent: number | null;
  classification: ClassifyLineResult;
};

export type PreviewTotals = {
  total: number;
  toApply: number;
  blocked: number;
  withWarning: number;
  withoutNewPrice: number;
};

export async function previewBatch(batchId: string): Promise<{
  batch: { id: string; code: string; status: PriceUpdateBatchStatus; target: PriceUpdateBatchTarget; branchIds: string[]; reason: string };
  lines: PreviewLine[];
  totals: PreviewTotals;
}> {
  const batch = await prisma.priceUpdateBatch.findUniqueOrThrow({ where: { id: batchId } });
  const lines = await prisma.priceUpdateLine.findMany({
    where: { batchId },
    include: {
      product: { select: { sku: true, name: true, isActive: true } },
      branch: { select: { code: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const branchProductPairs = lines
    .filter((l) => l.branchId)
    .map((l) => ({ branchId: l.branchId as string, productId: l.productId }));
  const policyByKey = await resolvePolicyForProductBatch(branchProductPairs, prisma);

  const previewLines: PreviewLine[] = lines.map((line) => {
    const costSnapshot = line.costSnapshot != null ? Number(line.costSnapshot) : null;
    const currentPriceSnapshot = line.currentPriceSnapshot != null ? Number(line.currentPriceSnapshot) : null;
    const newPrice = line.newPrice != null ? Number(line.newPrice) : null;
    const policy = line.branchId ? policyByKey.get(`${line.branchId}:${line.productId}`) : undefined;

    // Una línea ya resuelta (APPLIED/CONFLICT/SKIPPED tras un apply previo)
    // se muestra TAL CUAL quedó — classifyLine es solo para lo que sigue
    // pendiente de decidir.
    const classification: ClassifyLineResult = line.status === "PENDING"
      ? classifyLine(
          {
            newPrice,
            costSnapshot,
            currentPriceSnapshot,
            priceSourceSnapshot: line.priceSourceSnapshot,
            // Re-chequeado fresco (no inferido del status guardado): el
            // producto pudo desactivarse DESPUÉS de crear la línea.
            productIsActive: line.product.isActive,
          },
          { minMarginPercent: policy?.categoryPolicy.minMarginPercent ?? null },
        )
      : line.status === "BLOCKED"
        ? { status: "BLOCKED", reason: line.message ?? "Bloqueada." }
        : newPrice == null
          ? { status: "SKIPPED", reason: "Sin precio nuevo." }
          : { status: "PENDING", warnings: [], marginNew: null, changePercent: null };

    return {
      id: line.id,
      productId: line.productId,
      productSku: line.product.sku,
      productName: line.product.name,
      branchId: line.branchId,
      branchCode: line.branch?.code ?? null,
      costSnapshot,
      currentPriceSnapshot,
      priceSourceSnapshot: line.priceSourceSnapshot,
      newPrice,
      status: line.status,
      dbMessage: line.message,
      marginCurrent: costSnapshot != null && currentPriceSnapshot != null
        ? (currentPriceSnapshot > 0 && costSnapshot > 0 ? ((currentPriceSnapshot - costSnapshot) / currentPriceSnapshot) * 100 : null)
        : null,
      marginNew: classification.status === "PENDING" ? classification.marginNew : null,
      changePercent: classification.status === "PENDING" ? classification.changePercent : null,
      classification,
    };
  });

  const totals: PreviewTotals = {
    total: previewLines.length,
    toApply: previewLines.filter((l) => l.status === "PENDING" && l.classification.status === "PENDING").length,
    blocked: previewLines.filter((l) => l.classification.status === "BLOCKED").length,
    withWarning: previewLines.filter((l) => l.classification.status === "PENDING" && l.classification.warnings.length > 0).length,
    withoutNewPrice: previewLines.filter((l) => l.classification.status === "SKIPPED").length,
  };

  return {
    batch: { id: batch.id, code: batch.code, status: batch.status, target: batch.target, branchIds: batch.branchIds, reason: batch.reason },
    lines: previewLines,
    totals,
  };
}

export async function cancelDraftTx(
  tx: Prisma.TransactionClient,
  batchId: string,
): Promise<{ id: string; status: PriceUpdateBatchStatus }> {
  await tx.$queryRaw`SELECT id FROM "PriceUpdateBatch" WHERE id = ${batchId} FOR UPDATE`;
  const batch = await tx.priceUpdateBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("NOT_FOUND");
  if (batch.status !== "DRAFT") throw new Error("ALREADY_PROCESSED");

  const result = await tx.priceUpdateBatch.updateMany({ where: { id: batchId, status: "DRAFT" }, data: { status: "CANCELLED" } });
  if (result.count === 0) throw new Error("ALREADY_PROCESSED");

  return { id: batchId, status: "CANCELLED" };
}

export async function cancelDraft(batchId: string): Promise<{ id: string; status: PriceUpdateBatchStatus }> {
  return prisma.$transaction((tx) => cancelDraftTx(tx, batchId));
}

export async function listBatches(filters: { status?: PriceUpdateBatchStatus; limit?: number; offset?: number }) {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const where = filters.status ? { status: filters.status } : {};
  const [rows, total] = await Promise.all([
    prisma.priceUpdateBatch.findMany({
      where,
      include: {
        createdBy: { select: { fullName: true, username: true } },
        appliedBy: { select: { fullName: true, username: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.priceUpdateBatch.count({ where }),
  ]);

  const appliedCounts = await prisma.priceUpdateLine.groupBy({
    by: ["batchId"],
    where: { batchId: { in: rows.map((r) => r.id) }, status: "APPLIED" },
    _count: { _all: true },
  });
  const appliedByBatchId = new Map(appliedCounts.map((c) => [c.batchId, c._count._all]));

  return {
    rows: rows.map((r) => ({
      id: r.id,
      code: r.code,
      status: r.status,
      target: r.target,
      branchIds: r.branchIds,
      reason: r.reason,
      source: r.source,
      createdByName: r.createdBy.fullName ?? r.createdBy.username,
      appliedByName: r.appliedBy?.fullName ?? r.appliedBy?.username ?? null,
      createdAt: r.createdAt,
      appliedAt: r.appliedAt,
      linesTotal: r._count.lines,
      linesApplied: appliedByBatchId.get(r.id) ?? 0,
    })),
    total,
  };
}
