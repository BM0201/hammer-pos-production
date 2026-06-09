import { Prisma, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { SALE_AUDIT_EVENTS } from "@/modules/sales/audit-events";

export type SalesManagementFilters = {
  branchIds?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  status?: SaleOrderStatus;
  // Por defecto el panel SÍ muestra pruebas/anuladas (es su propósito), pero
  // permite filtrarlas explícitamente.
  testFilter?: "all" | "only" | "exclude";
  voidedFilter?: "all" | "only" | "exclude";
  search?: string;
  take?: number;
};

function buildWhere(filters: SalesManagementFilters): Prisma.SaleOrderWhereInput {
  const where: Prisma.SaleOrderWhereInput = {};

  if (filters.branchIds?.length) where.branchId = { in: filters.branchIds };
  if (filters.status) where.status = filters.status;

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }

  if (filters.testFilter === "only") where.isTest = true;
  else if (filters.testFilter === "exclude") where.isTest = false;

  if (filters.voidedFilter === "only") where.voidedAt = { not: null };
  else if (filters.voidedFilter === "exclude") where.voidedAt = null;

  if (filters.search?.trim()) {
    const term = filters.search.trim();
    where.OR = [
      { orderNumber: { contains: term, mode: "insensitive" } },
      { customer: { is: { displayName: { contains: term, mode: "insensitive" } } } },
      { customer: { is: { legalName: { contains: term, mode: "insensitive" } } } },
    ];
  }

  return where;
}

/**
 * Lista TODAS las ventas para el panel de gestión (Master/Admin), con filtros
 * por fecha, sucursal, estado y banderas de prueba/anulación.
 */
export async function listSaleOrdersForManagement(filters: SalesManagementFilters) {
  const take = Math.min(Math.max(filters.take ?? 200, 1), 1000);
  const rows = await prisma.saleOrder.findMany({
    where: buildWhere(filters),
    include: {
      branch: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, username: true, fullName: true } },
      voidedBy: { select: { id: true, username: true, fullName: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: "desc" },
    take,
  });

  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    branchId: row.branchId,
    branchCode: row.branch.code,
    branchName: row.branch.name,
    createdAt: row.createdAt.toISOString(),
    seller: row.createdBy?.fullName || row.createdBy?.username || "—",
    linesCount: row._count.lines,
    subtotal: Number(row.subtotal),
    discountTotal: Number(row.discountTotal),
    grandTotal: Number(row.grandTotal),
    isTest: row.isTest,
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    voidReason: row.voidReason,
    voidedBy: row.voidedBy ? row.voidedBy.fullName || row.voidedBy.username : null,
  }));
}

/**
 * Marca o desmarca una venta como "de prueba". Las ventas de prueba quedan
 * excluidas de reportes y métricas, pero no se borran.
 */
export async function markSaleOrderAsTest(input: {
  saleOrderId: string;
  actorUserId: string;
  isTest: boolean;
  reason?: string | null;
}) {
  const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: input.saleOrderId } });

  const updated = await prisma.saleOrder.update({
    where: { id: input.saleOrderId },
    data: { isTest: input.isTest },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: order.branchId,
    module: "sales",
    action: input.isTest ? SALE_AUDIT_EVENTS.ORDER_MARKED_TEST : SALE_AUDIT_EVENTS.ORDER_UNMARKED_TEST,
    entityType: "SaleOrder",
    entityId: input.saleOrderId,
    metadataJson: { reason: input.reason ?? null, orderNumber: order.orderNumber },
  });

  return updated;
}

/**
 * Anula (o restaura) una venta con justificación. La anulación no borra la
 * venta: la marca con fecha/usuario/motivo y la excluye de reportes/métricas.
 */
export async function setSaleOrderVoided(input: {
  saleOrderId: string;
  actorUserId: string;
  voided: boolean;
  reason?: string | null;
}) {
  const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: input.saleOrderId } });

  if (input.voided && !input.reason?.trim()) {
    throw new Error("VOID_REASON_REQUIRED");
  }

  const updated = await prisma.saleOrder.update({
    where: { id: input.saleOrderId },
    data: input.voided
      ? { voidedAt: new Date(), voidedByUserId: input.actorUserId, voidReason: input.reason!.trim() }
      : { voidedAt: null, voidedByUserId: null, voidReason: null },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: order.branchId,
    module: "sales",
    action: SALE_AUDIT_EVENTS.ORDER_VOIDED,
    entityType: "SaleOrder",
    entityId: input.saleOrderId,
    metadataJson: { voided: input.voided, reason: input.reason ?? null, orderNumber: order.orderNumber },
  });

  return updated;
}
