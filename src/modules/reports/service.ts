import { ApprovalStatus, Prisma, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Default fallback reorder point when no StockReorderPolicy exists. */
const DEFAULT_REORDER_FALLBACK = 5;

type ReportFilters = {
  branchIds?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  status?: string;
  actorUsername?: string;
};

function dateWhere(filters: ReportFilters, field: "createdAt" | "paidAt" | "occurredAt" | "dispatchedAt") {
  if (!filters.dateFrom && !filters.dateTo) return {};
  return {
    [field]: {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    },
  };
}

function branchWhere(filters: ReportFilters, field = "branchId") {
  if (!filters.branchIds?.length) return {};
  return { [field]: { in: filters.branchIds } };
}

export async function getSalesReportRows(filters: ReportFilters) {
  const rows = await prisma.saleOrder.findMany({
    where: {
      ...branchWhere(filters),
      ...dateWhere(filters, "createdAt"),
      ...(filters.status ? { status: filters.status as SaleOrderStatus } : {}),
    },
    include: { branch: { select: { code: true, name: true } }, createdBy: { select: { username: true } } },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });

  return rows.map((row) => ({
    fecha: row.createdAt.toISOString(),
    sucursal_codigo: row.branch.code,
    sucursal_nombre: row.branch.name,
    orden: row.orderNumber,
    estado: row.status,
    vendedor: row.createdBy.username,
    total: row.grandTotal.toString(),
  }));
}

export async function getPaymentsReportRows(filters: ReportFilters) {
  const rows = await prisma.payment.findMany({
    where: {
      saleOrder: { ...branchWhere(filters) },
      ...dateWhere(filters, "paidAt"),
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.actorUsername ? { receivedBy: { username: { contains: filters.actorUsername } } } : {}),
    },
    include: {
      saleOrder: { select: { orderNumber: true, branch: { select: { code: true, name: true } } } },
      receivedBy: { select: { username: true } },
    },
    orderBy: { paidAt: "desc" },
    take: 2000,
  });

  return rows.map((row) => ({
    fecha_pago: row.paidAt.toISOString(),
    sucursal_codigo: row.saleOrder.branch.code,
    sucursal_nombre: row.saleOrder.branch.name,
    orden: row.saleOrder.orderNumber,
    metodo: row.method,
    estado: row.status,
    cajero: row.receivedBy.username,
    monto: row.amount.toString(),
    referencia: row.referenceNumber ?? "",
  }));
}

export async function getDispatchReportRows(filters: ReportFilters) {
  const rows = await prisma.dispatchTicket.findMany({
    where: {
      ...branchWhere(filters),
      ...dateWhere(filters, "createdAt"),
      ...(filters.status ? { status: filters.status as never } : {}),
    },
    include: {
      branch: { select: { code: true, name: true } },
      saleOrder: { select: { orderNumber: true } },
      processedBy: { select: { username: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });

  return rows.map((row) => ({
    fecha: row.createdAt.toISOString(),
    sucursal_codigo: row.branch.code,
    sucursal_nombre: row.branch.name,
    orden: row.saleOrder.orderNumber,
    estado: row.status,
    despachado_por: row.processedBy?.username ?? "",
    fecha_despacho: row.dispatchedAt?.toISOString() ?? "",
    notas: row.notes ?? "",
  }));
}

export async function getApprovalsReportRows(filters: ReportFilters) {
  const rows = await prisma.approvalRequest.findMany({
    where: {
      ...branchWhere(filters),
      ...dateWhere(filters, "createdAt"),
      ...(filters.status ? { status: filters.status as ApprovalStatus } : {}),
      ...(filters.actorUsername ? { requestedBy: { username: { contains: filters.actorUsername } } } : {}),
    },
    include: {
      branch: { select: { code: true, name: true } },
      requestedBy: { select: { username: true } },
      resolvedBy: { select: { username: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });

  return rows.map((row) => ({
    fecha_solicitud: row.createdAt.toISOString(),
    sucursal_codigo: row.branch.code,
    sucursal_nombre: row.branch.name,
    tipo: row.type,
    estado: row.status,
    solicitado_por: row.requestedBy.username,
    resuelto_por: row.resolvedBy?.username ?? "",
    referencia_tipo: row.referenceType,
    referencia_id: row.referenceId,
    motivo: row.reason,
  }));
}

export async function getAuditReportRows(filters: ReportFilters) {
  const rows = await prisma.auditLog.findMany({
    where: {
      ...branchWhere(filters),
      ...dateWhere(filters, "occurredAt"),
      ...(filters.status ? { action: { contains: filters.status } } : {}),
      ...(filters.actorUsername ? { actor: { username: { contains: filters.actorUsername } } } : {}),
    },
    include: {
      branch: { select: { code: true, name: true } },
      actor: { select: { username: true } },
    },
    orderBy: { occurredAt: "desc" },
    take: 3000,
  });

  return rows.map((row) => ({
    fecha: row.occurredAt.toISOString(),
    sucursal_codigo: row.branch?.code ?? "",
    sucursal_nombre: row.branch?.name ?? "",
    modulo: row.module,
    accion: row.action,
    usuario: row.actor?.username ?? "sistema",
    entidad: row.entityType,
    entidad_id: row.entityId,
  }));
}

export async function getInventoryCriticalReportRows(filters: ReportFilters) {
  // Use StockReorderPolicy.reorderPoint when configured; otherwise fall back to
  // the legacy threshold. The query joins on the active policy for each
  // (branch, product) pair and selects balances at-or-below the effective threshold.
  const hasBranchFilter = !!filters.branchIds?.length;
  const branchClause = hasBranchFilter
    ? Prisma.sql`AND ib."branchId" IN (${Prisma.join(filters.branchIds!)})`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{
      branchCode: string;
      branchName: string;
      sku: string;
      productName: string;
      quantityOnHand: Prisma.Decimal;
      weightedAverageCost: Prisma.Decimal;
      inventoryValue: Prisma.Decimal;
    }>
  >`
    SELECT
      b."code"                                AS "branchCode",
      b."name"                                AS "branchName",
      p."sku"                                 AS "sku",
      p."name"                                AS "productName",
      ib."quantityOnHand"                     AS "quantityOnHand",
      ib."weightedAverageCost"                AS "weightedAverageCost",
      ib."inventoryValue"                     AS "inventoryValue"
    FROM "InventoryBalance" ib
    INNER JOIN "Branch"  b ON b."id" = ib."branchId"
    INNER JOIN "Product" p ON p."id" = ib."productId"
    LEFT JOIN "StockReorderPolicy" srp
      ON srp."branchId"  = ib."branchId"
     AND srp."productId" = ib."productId"
     AND srp."isActive"  = true
    WHERE ib."quantityOnHand" <= COALESCE(srp."reorderPoint", ${DEFAULT_REORDER_FALLBACK})
    ${branchClause}
    ORDER BY ib."quantityOnHand" ASC
    LIMIT 2000
  `;

  return rows.map((row) => ({
    sucursal_codigo: row.branchCode,
    sucursal_nombre: row.branchName,
    sku: row.sku,
    producto: row.productName,
    existencia: row.quantityOnHand.toString(),
    costo_promedio: row.weightedAverageCost.toString(),
    valor_inventario: row.inventoryValue.toString(),
  }));
}
