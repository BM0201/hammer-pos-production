import { randomBytes } from "crypto";
import { Prisma, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { consumeSharedStockForSaleTx } from "@/modules/inventory/service";
import { logAuditEvent } from "@/modules/audit/service";

export type OfflineSyncLine = {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
};

export type OfflineSyncInput = {
  offlineId: string;
  branchId: string;
  cashSessionId: string;
  actorUserId: string;
  lines: OfflineSyncLine[];
  grandTotal: number;
  notes?: string;
  createdAt: string; // ISO — when the sale was made offline
};

function makeOrderNumber(branchCode: string) {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(4).toString("hex").toUpperCase();
  return `SO-${branchCode}-${ts}-${rand}`;
}

export async function syncOfflineSale(input: OfflineSyncInput) {
  // ── 1. Validate cash session timing ────────────────────────────────────────
  const session = await prisma.cashSession.findUnique({
    where: { id: input.cashSessionId },
    include: { physicalCashBox: { select: { branchId: true, isActive: true } } },
  });
  if (!session) throw new Error("INVALID_CASH_SESSION");
  if (session.physicalCashBox.branchId !== input.branchId) throw new Error("CASH_BOX_BRANCH_MISMATCH");

  const saleTime = new Date(input.createdAt);
  if (isNaN(saleTime.getTime())) throw new Error("INVALID_CREATED_AT");
  if (saleTime < session.openedAt) throw new Error("OFFLINE_SALE_BEFORE_SESSION_OPEN");
  if (session.closedAt && saleTime > session.closedAt) throw new Error("OFFLINE_SALE_AFTER_SESSION_CLOSE");

  // ── 2. Validate products ────────────────────────────────────────────────────
  const productIds = [...new Set(input.lines.map(l => l.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true },
  });
  if (products.length !== productIds.length) throw new Error("INVALID_PRODUCTS");

  // ── 3. Check for duplicate (idempotency) ───────────────────────────────────
  const duplicate = await prisma.saleOrder.findFirst({
    where: { notes: { contains: input.offlineId } },
    select: { id: true, orderNumber: true },
  });
  if (duplicate) {
    return { orderId: duplicate.id, orderNumber: duplicate.orderNumber, alreadySynced: true };
  }

  // ── 4. Fetch branch code for order number ──────────────────────────────────
  const branch = await prisma.branch.findUniqueOrThrow({
    where: { id: input.branchId },
    select: { code: true },
  });

  // ── 5. Transaction: create order + lines + inventory + payment ─────────────
  const result = await prisma.$transaction(async (tx) => {
    const subtotal = input.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const discountTotal = input.lines.reduce((s, l) => s + l.discountAmount, 0);

    const order = await tx.saleOrder.create({
      data: {
        orderNumber: makeOrderNumber(branch.code),
        branchId: input.branchId,
        createdByUserId: input.actorUserId,
        status: SaleOrderStatus.DISPATCHED,
        subtotal: new Prisma.Decimal(subtotal),
        discountTotal: new Prisma.Decimal(discountTotal),
        taxTotal: new Prisma.Decimal(0),
        grandTotal: new Prisma.Decimal(input.grandTotal),
        notes: input.notes
          ? `[OFFLINE:${input.offlineId}] ${input.notes}`
          : `[OFFLINE:${input.offlineId}]`,
        createdAt: saleTime,
      },
    });

    for (const line of input.lines) {
      const lineSubtotal = line.quantity * line.unitPrice - line.discountAmount;
      await tx.saleOrderLine.create({
        data: {
          saleOrderId: order.id,
          productId: line.productId,
          quantity: new Prisma.Decimal(line.quantity),
          unitPrice: new Prisma.Decimal(line.unitPrice),
          discountAmount: new Prisma.Decimal(line.discountAmount),
          lineSubtotal: new Prisma.Decimal(lineSubtotal),
        },
      });

      // Deduct inventory — best-effort (won't throw on negative stock)
      try {
        await consumeSharedStockForSaleTx(tx, {
          branchId: input.branchId,
          productId: line.productId,
          quantity: line.quantity,
          userId: input.actorUserId,
          saleOrderId: order.id,
          referenceType: "DIRECT_SALE",
          referenceId: order.id,
          notes: `Venta offline sincronizada (${input.offlineId})`,
        });
      } catch {
        // Stock insuficiente en offline sync — registra pero no bloquea
        await tx.auditLog.create({
          data: {
            actorUserId: input.actorUserId,
            branchId: input.branchId,
            module: "sales",
            action: "OFFLINE_SYNC_STOCK_WARNING",
            entityType: "SaleOrderLine",
            entityId: order.id,
            metadataJson: { offlineId: input.offlineId, productId: line.productId, quantity: line.quantity },
          },
        });
      }
    }

    await tx.payment.create({
      data: {
        saleOrderId: order.id,
        cashSessionId: input.cashSessionId,
        method: "CASH",
        amount: new Prisma.Decimal(input.grandTotal),
        status: "COMPLETED",
      },
    });

    return { orderId: order.id, orderNumber: order.orderNumber };
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "sales",
    action: "OFFLINE_SALE_SYNCED",
    entityType: "SaleOrder",
    entityId: result.orderId,
    metadataJson: {
      offlineId: input.offlineId,
      originalCreatedAt: input.createdAt,
      cashSessionId: input.cashSessionId,
      grandTotal: input.grandTotal,
      lineCount: input.lines.length,
    },
  });

  return { ...result, alreadySynced: false };
}
