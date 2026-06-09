import { InventoryMovementType, Prisma, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SALE_AUDIT_EVENTS } from "@/modules/sales/audit-events";
import { createInventoryMovementTx } from "@/modules/inventory/service";
import { getSharedInventoryBalance } from "@/modules/inventory/unit-conversion";

/**
 * Estados de venta que, al momento de marcarse como prueba o anularse, ya
 * descontaron inventario (vía SALE_OUT). Para estos, la reversión debe
 * devolver las unidades al inventario (RETURN_IN).
 */
const STOCK_DEDUCTED_STATUSES: SaleOrderStatus[] = [
  SaleOrderStatus.PAID,
  SaleOrderStatus.DISPATCH_PENDING,
  SaleOrderStatus.DISPATCHED,
];

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
 * Construye un snapshot completo del contenido de una venta: cliente, vendedor,
 * fecha, líneas (producto, cantidad, precio, subtotal) y totales. Se conserva
 * como historial inmutable en la bitácora de auditoría antes de excluir la
 * venta (marcar prueba / anular), de modo que siempre quede registro de "qué se
 * vendió" aunque la venta deje de contar en métricas.
 */
async function buildSaleSnapshot(db: Prisma.TransactionClient, saleOrderId: string) {
  const order = await db.saleOrder.findUniqueOrThrow({
    where: { id: saleOrderId },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      customer: { select: { id: true, code: true, displayName: true, legalName: true, taxId: true } },
      createdBy: { select: { id: true, username: true, fullName: true } },
      lines: {
        include: { product: { select: { id: true, sku: true, name: true, unit: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    archivedAt: new Date().toISOString(),
    branch: order.branch ? { id: order.branch.id, code: order.branch.code, name: order.branch.name } : null,
    customer: order.customer
      ? {
          id: order.customer.id,
          code: order.customer.code,
          name: order.customer.displayName || order.customer.legalName,
          taxId: order.customer.taxId ?? null,
        }
      : null,
    seller: order.createdBy?.fullName || order.createdBy?.username || null,
    createdAt: order.createdAt.toISOString(),
    lines: order.lines.map((l) => ({
      productId: l.productId,
      sku: l.product.sku,
      name: l.product.name,
      unit: l.product.unit,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountAmount: Number(l.discountAmount),
      lineSubtotal: Number(l.lineSubtotal),
    })),
    totals: {
      subtotal: Number(order.subtotal),
      discountTotal: Number(order.discountTotal),
      manualDiscountAmount: Number(order.manualDiscountAmount),
      taxTotal: Number(order.taxTotal),
      transportAmount: Number(order.transportAmount),
      grandTotal: Number(order.grandTotal),
    },
  };
}

/**
 * Revierte el inventario de una venta que ya había descontado existencias
 * (SALE_OUT), devolviendo las unidades vendidas con movimientos RETURN_IN.
 * Solo aplica a ventas en estados que descuentan stock (PAID/DESPACHO/DESPACHADO).
 * Devuelve la lista de movimientos de reversión creados (puede estar vacía).
 */
async function revertSaleInventoryTx(
  tx: Prisma.TransactionClient,
  params: { saleOrderId: string; actorUserId: string; reason: string },
) {
  const order = await tx.saleOrder.findUniqueOrThrow({
    where: { id: params.saleOrderId },
    include: { lines: true },
  });

  if (!STOCK_DEDUCTED_STATUSES.includes(order.status)) {
    return { reverted: false as const, movements: [] as string[] };
  }

  const movements: string[] = [];
  for (const line of order.lines) {
    const shared = await getSharedInventoryBalance(tx, { branchId: order.branchId, productId: line.productId });
    const currentWac = shared.balance?.weightedAverageCost ?? new Prisma.Decimal(0);
    const result = await createInventoryMovementTx(tx, {
      actorUserId: params.actorUserId,
      branchId: order.branchId,
      productId: line.productId,
      movementType: InventoryMovementType.RETURN_IN,
      quantity: Number(line.quantity),
      unitCost: Number(currentWac),
      referenceType: "SALE_REVERSAL",
      referenceId: order.id,
      notes: `Reversión de inventario por ${params.reason} · orden ${order.orderNumber}`,
    });
    movements.push(result.movement.id);
  }

  return { reverted: movements.length > 0, movements };
}

/**
 * Marca o desmarca una venta como "de prueba". Las ventas de prueba quedan
 * excluidas de reportes y métricas, pero no se borran.
 *
 * Al MARCAR como prueba: se archiva un snapshot completo del contenido de la
 * venta (historial) y, si la venta ya había descontado inventario, se revierte
 * automáticamente (RETURN_IN) para que las existencias queden correctas.
 */
export async function markSaleOrderAsTest(input: {
  saleOrderId: string;
  actorUserId: string;
  isTest: boolean;
  reason?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.saleOrder.findUniqueOrThrow({ where: { id: input.saleOrderId } });

    // Archivar historial + revertir inventario únicamente al excluir la venta.
    if (input.isTest) {
      const snapshot = await buildSaleSnapshot(tx, input.saleOrderId);
      const revert = await revertSaleInventoryTx(tx, {
        saleOrderId: input.saleOrderId,
        actorUserId: input.actorUserId,
        reason: "marcar como prueba",
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "sales",
          action: SALE_AUDIT_EVENTS.ORDER_SNAPSHOT_ARCHIVED,
          entityType: "SaleOrder",
          entityId: input.saleOrderId,
          metadataJson: {
            trigger: "MARK_TEST",
            reason: input.reason ?? null,
            inventoryReverted: revert.reverted,
            reversalMovements: revert.movements,
            snapshot,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const updated = await tx.saleOrder.update({
      where: { id: input.saleOrderId },
      data: { isTest: input.isTest },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        module: "sales",
        action: input.isTest ? SALE_AUDIT_EVENTS.ORDER_MARKED_TEST : SALE_AUDIT_EVENTS.ORDER_UNMARKED_TEST,
        entityType: "SaleOrder",
        entityId: input.saleOrderId,
        metadataJson: { reason: input.reason ?? null, orderNumber: order.orderNumber } as Prisma.InputJsonValue,
      },
    });

    return updated;
  });
}

/**
 * Anula (o restaura) una venta con justificación. La anulación no borra la
 * venta: la marca con fecha/usuario/motivo y la excluye de reportes/métricas.
 *
 * Al ANULAR: se archiva un snapshot completo (historial) y, si la venta había
 * descontado inventario, se revierte automáticamente (RETURN_IN).
 */
export async function setSaleOrderVoided(input: {
  saleOrderId: string;
  actorUserId: string;
  voided: boolean;
  reason?: string | null;
}) {
  if (input.voided && !input.reason?.trim()) {
    throw new Error("VOID_REASON_REQUIRED");
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.saleOrder.findUniqueOrThrow({ where: { id: input.saleOrderId } });

    if (input.voided) {
      const snapshot = await buildSaleSnapshot(tx, input.saleOrderId);
      const revert = await revertSaleInventoryTx(tx, {
        saleOrderId: input.saleOrderId,
        actorUserId: input.actorUserId,
        reason: "anulación",
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "sales",
          action: SALE_AUDIT_EVENTS.ORDER_SNAPSHOT_ARCHIVED,
          entityType: "SaleOrder",
          entityId: input.saleOrderId,
          metadataJson: {
            trigger: "VOID",
            reason: input.reason ?? null,
            inventoryReverted: revert.reverted,
            reversalMovements: revert.movements,
            snapshot,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const updated = await tx.saleOrder.update({
      where: { id: input.saleOrderId },
      data: input.voided
        ? { voidedAt: new Date(), voidedByUserId: input.actorUserId, voidReason: input.reason!.trim() }
        : { voidedAt: null, voidedByUserId: null, voidReason: null },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_VOIDED,
        entityType: "SaleOrder",
        entityId: input.saleOrderId,
        metadataJson: { voided: input.voided, reason: input.reason ?? null, orderNumber: order.orderNumber } as Prisma.InputJsonValue,
      },
    });

    return updated;
  });
}

/**
 * Devuelve el detalle COMPLETO de una venta para la página de factura/detalle:
 * cliente, vendedor, sucursal, fecha, líneas (producto, cantidad, precio,
 * descuento, subtotal), totales y pagos registrados. Solo lectura.
 */
export async function getSaleOrderDetail(saleOrderId: string) {
  const order = await prisma.saleOrder.findUnique({
    where: { id: saleOrderId },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      customer: { select: { id: true, code: true, displayName: true, legalName: true, taxId: true, phone: true, email: true, address: true } },
      createdBy: { select: { id: true, username: true, fullName: true } },
      voidedBy: { select: { id: true, username: true, fullName: true } },
      lines: {
        include: { product: { select: { id: true, sku: true, name: true, unit: true } } },
        orderBy: { createdAt: "asc" },
      },
      payments: {
        select: { id: true, method: true, status: true, amount: true, referenceNumber: true, paidAt: true },
        orderBy: { paidAt: "asc" },
      },
    },
  });

  if (!order) return null;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    isTest: order.isTest,
    voidedAt: order.voidedAt ? order.voidedAt.toISOString() : null,
    voidReason: order.voidReason,
    voidedBy: order.voidedBy ? order.voidedBy.fullName || order.voidedBy.username : null,
    notes: order.notes,
    branch: { id: order.branch.id, code: order.branch.code, name: order.branch.name },
    customer: order.customer
      ? {
          id: order.customer.id,
          code: order.customer.code,
          name: order.customer.displayName || order.customer.legalName,
          taxId: order.customer.taxId ?? null,
          phone: order.customer.phone ?? null,
          email: order.customer.email ?? null,
          address: order.customer.address ?? null,
        }
      : null,
    seller: order.createdBy?.fullName || order.createdBy?.username || "—",
    lines: order.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      sku: l.product.sku,
      name: l.product.name,
      unit: l.product.unit,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountAmount: Number(l.discountAmount),
      lineSubtotal: Number(l.lineSubtotal),
    })),
    payments: order.payments.map((p) => ({
      id: p.id,
      method: p.method,
      status: p.status,
      amount: Number(p.amount),
      referenceNumber: p.referenceNumber,
      paidAt: p.paidAt.toISOString(),
    })),
    totals: {
      subtotal: Number(order.subtotal),
      discountTotal: Number(order.discountTotal),
      manualDiscountAmount: Number(order.manualDiscountAmount),
      taxTotal: Number(order.taxTotal),
      transportAmount: Number(order.transportAmount),
      grandTotal: Number(order.grandTotal),
    },
  };
}

export type SaleOrderDetail = NonNullable<Awaited<ReturnType<typeof getSaleOrderDetail>>>;
