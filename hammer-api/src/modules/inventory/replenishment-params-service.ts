import { prisma } from "@/lib/prisma";
import { resolveReceptionForOrders } from "@/modules/purchase-orders/service";

/* ════════════════════════════════════════════════════════════════
 * Reposición v2 — parámetros unificados (Fase 1.1)
 *
 * Una sola función de lectura resuelve, por (branch, producto), si el motor
 * debe usar el cálculo AUTOMÁTICO por demanda (replenishment-service.ts), un
 * OVERRIDE manual (StockReorderPolicy activa — se reutiliza tal cual, no se
 * crea un campo "modo" separado para este caso: su sola existencia activa YA
 * significa override) o si el producto está EXCLUIDO
 * (BranchProductSetting.replenishmentExcluded).
 *
 * Para modo AUTO esta función NO calcula el punto/objetivo dinámico (eso vive
 * en replenishment-service.ts porque depende de demanda real + clase ABC/XYZ,
 * ya cargadas ahí) — solo informa que no hay override ni exclusión. El caller
 * (getReplenishmentSignals) es quien decide qué número usar según el modo.
 * ════════════════════════════════════════════════════════════════ */

export type ReplenishmentMode = "AUTO" | "MANUAL_OVERRIDE" | "EXCLUDED";

export type ReplenishmentParams = {
  mode: ReplenishmentMode;
  reorderPoint: number | null;
  targetQuantity: number | null;
  safetyStock: number | null;
  leadTimeDays: number | null;
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
};

const EXCLUDED_PARAMS: ReplenishmentParams = {
  mode: "EXCLUDED",
  reorderPoint: null,
  targetQuantity: null,
  safetyStock: null,
  leadTimeDays: null,
  preferredSupplierId: null,
  preferredSupplierName: null,
};

const AUTO_PARAMS: ReplenishmentParams = {
  mode: "AUTO",
  reorderPoint: null,
  targetQuantity: null,
  safetyStock: null,
  leadTimeDays: null,
  preferredSupplierId: null,
  preferredSupplierName: null,
};

export async function resolveReplenishmentParamsBatch(
  branchId: string,
  productIds: string[],
): Promise<Map<string, ReplenishmentParams>> {
  const result = new Map<string, ReplenishmentParams>();
  if (productIds.length === 0) return result;

  const [settings, policies] = await Promise.all([
    prisma.branchProductSetting.findMany({
      where: { branchId, productId: { in: productIds } },
      select: { productId: true, replenishmentExcluded: true },
    }),
    prisma.stockReorderPolicy.findMany({
      where: { branchId, productId: { in: productIds }, isActive: true },
      include: { preferredSupplierRef: { select: { id: true, name: true } } },
    }),
  ]);

  const excludedProductIds = new Set(settings.filter((s) => s.replenishmentExcluded).map((s) => s.productId));
  const policyByProductId = new Map(policies.map((p) => [p.productId, p]));

  for (const productId of productIds) {
    if (excludedProductIds.has(productId)) {
      result.set(productId, EXCLUDED_PARAMS);
      continue;
    }
    const policy = policyByProductId.get(productId);
    if (policy) {
      result.set(productId, {
        mode: "MANUAL_OVERRIDE",
        reorderPoint: Number(policy.reorderPoint),
        targetQuantity: Number(policy.targetQuantity),
        safetyStock: Number(policy.safetyStock),
        leadTimeDays: policy.leadTimeDays,
        preferredSupplierId: policy.preferredSupplierId ?? policy.preferredSupplierRef?.id ?? null,
        preferredSupplierName: policy.preferredSupplierRef?.name ?? policy.preferredSupplier ?? null,
      });
      continue;
    }
    result.set(productId, AUTO_PARAMS);
  }

  return result;
}

export async function resolveReplenishmentParams(branchId: string, productId: string): Promise<ReplenishmentParams> {
  const map = await resolveReplenishmentParamsBatch(branchId, [productId]);
  return map.get(productId) ?? AUTO_PARAMS;
}

/* ════════════════════════════════════════════════════════════════
 * Reposición v2 — "En camino" (Fase 1.2)
 *
 * Cuánto de lo pendiente ya está comprometido (pedido aprobado o traslado en
 * tránsito) hacia una sucursal, agregado por producto. Se usa para descontar
 * de la necesidad neta y para la vista "En camino". Cada lado es UNA sola
 * consulta agregada (nunca un query por documento).
 * ════════════════════════════════════════════════════════════════ */

export type InboundDocument = {
  kind: "PURCHASE_ORDER" | "TRANSFER";
  documentId: string;
  documentNumber: string;
  originLabel: string | null;
  pendingQuantity: number;
  createdAt: Date;
  expectedAt: Date;
};

export type InboundSummary = {
  poQuantity: number;
  transferQuantity: number;
  totalQuantity: number;
  documents: InboundDocument[];
};

async function getInboundPurchaseQuantities(branchId: string, productIds: string[]) {
  const byProduct = new Map<string, { pendingQuantity: number; documents: InboundDocument[] }>();
  if (productIds.length === 0) return byProduct;

  const orders = await prisma.purchaseOrder.findMany({
    where: { branchId, status: "APPROVED", lines: { some: { productId: { in: productIds } } } },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      createdAt: true,
      lines: { select: { id: true, productId: true, quantity: true } },
    },
  });
  if (orders.length === 0) return byProduct;

  const receptionByOrderId = await resolveReceptionForOrders(
    orders.map((po) => ({ id: po.id, status: po.status, lines: po.lines })),
  );

  for (const po of orders) {
    const reception = receptionByOrderId.get(po.id);
    for (const line of po.lines) {
      if (!productIds.includes(line.productId)) continue;
      const pending = reception?.lines.get(line.id)?.pendingQuantity ?? Number(line.quantity);
      if (pending <= 0) continue;
      const entry = byProduct.get(line.productId) ?? { pendingQuantity: 0, documents: [] };
      entry.pendingQuantity += pending;
      entry.documents.push({
        kind: "PURCHASE_ORDER",
        documentId: po.id,
        documentNumber: po.orderNumber,
        originLabel: null,
        pendingQuantity: pending,
        createdAt: po.createdAt,
        expectedAt: po.createdAt,
      });
      byProduct.set(line.productId, entry);
    }
  }
  return byProduct;
}

export async function getInboundTransferQuantities(branchId: string, productIds: string[]) {
  const byProduct = new Map<string, { pendingQuantity: number; documents: InboundDocument[] }>();
  if (productIds.length === 0) return byProduct;

  const transfers = await prisma.transfer.findMany({
    where: {
      toBranchId: branchId,
      status: { in: ["APPROVED", "IN_TRANSIT", "PARTIALLY_RECEIVED"] },
      lines: { some: { productId: { in: productIds } } },
    },
    select: {
      id: true,
      transferNumber: true,
      status: true,
      createdAt: true,
      dispatchedAt: true,
      fromBranch: { select: { code: true, name: true } },
      lines: { where: { productId: { in: productIds } }, select: { productId: true, quantityRequested: true, quantityDispatched: true, quantityReceived: true } },
    },
  });

  for (const transfer of transfers) {
    for (const line of transfer.lines) {
      const pending = transfer.status === "APPROVED"
        ? Number(line.quantityRequested)
        : Number(line.quantityDispatched) - Number(line.quantityReceived);
      if (pending <= 0) continue;
      const entry = byProduct.get(line.productId) ?? { pendingQuantity: 0, documents: [] };
      entry.pendingQuantity += pending;
      entry.documents.push({
        kind: "TRANSFER",
        documentId: transfer.id,
        documentNumber: transfer.transferNumber,
        originLabel: `${transfer.fromBranch.code} — ${transfer.fromBranch.name}`,
        pendingQuantity: pending,
        createdAt: transfer.createdAt,
        expectedAt: transfer.dispatchedAt ?? transfer.createdAt,
      });
      byProduct.set(line.productId, entry);
    }
  }
  return byProduct;
}

export async function getInboundQuantities(branchId: string, productIds: string[]): Promise<Map<string, InboundSummary>> {
  const result = new Map<string, InboundSummary>();
  if (productIds.length === 0) return result;

  const [poMap, transferMap] = await Promise.all([
    getInboundPurchaseQuantities(branchId, productIds),
    getInboundTransferQuantities(branchId, productIds),
  ]);

  for (const productId of productIds) {
    const po = poMap.get(productId);
    const tr = transferMap.get(productId);
    result.set(productId, {
      poQuantity: po?.pendingQuantity ?? 0,
      transferQuantity: tr?.pendingQuantity ?? 0,
      totalQuantity: (po?.pendingQuantity ?? 0) + (tr?.pendingQuantity ?? 0),
      documents: [...(po?.documents ?? []), ...(tr?.documents ?? [])],
    });
  }

  return result;
}
