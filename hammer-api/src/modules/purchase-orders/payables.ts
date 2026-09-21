import { PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type DbClient = PrismaClient | Prisma.TransactionClient;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ═══════════════════════════════════════════════════════════════════════
   Cálculo puro de la deuda (prompt-cxp.md, Fase 1)
   ═══════════════════════════════════════════════════════════════════════ */

export type PayableDebtLine = {
  productId: string;
  /** PurchaseOrderLine.unitTaxAmount — impuesto POR UNIDAD de esa línea. */
  unitTaxAmount: number;
};

export type PayableDebtMovement = {
  productId: string;
  /** InventoryMovement.quantity de un PURCHASE_IN de esta orden. */
  quantity: number;
  /** InventoryMovement.unitCost — YA incluye flete/otros cargos prorrateados
   * del recibo real (no el estimado congelado en la orden al crearla). */
  unitCost: number;
};

/**
 * D1 (prompt-cxp.md): la deuda de una orden se CALCULA desde lo que
 * realmente se recibió, nunca desde `PurchaseOrder.total` — ese total se
 * congela al crear la orden (createPurchaseOrder) y no se recalcula al
 * recibir, así que no refleja ni el flete real de la recepción ni una
 * recepción parcial.
 *
 * Corrección verificada contra receivePurchaseOrder (purchase-orders/service.ts)
 * antes de escribir esto, porque el doc original asumía algo que el código
 * real no hace: con purchaseTaxTreatment="INCLUDE_IN_COST" el impuesto
 * quedaría "ya dentro" del unitCost del movimiento, así que no debía
 * sumarse aparte. Pero el unitCost que receivePurchaseOrder efectivamente
 * escribe en el InventoryMovement sale de `line.unitCostBeforeTax` + flete
 * + otros cargos (service.ts, variable local `baseUnitCost`/`finalUnitCost`
 * dentro de la transacción de recepción) — SIN IMPUESTO, para los DOS
 * tratamientos por igual. `purchaseTaxTreatment` solo afecta el
 * `finalUnitCost` que se guarda en PurchaseOrderLine al CREAR la orden (un
 * valor de referencia/reporte), no lo que realmente se postea al inventario
 * al recibir. La UI de recepción (purchase-orders/page.tsx) tampoco manda
 * nunca `items[].unitCost` — así que en el 100% del uso real, el impuesto
 * NUNCA está en el movimiento. Por eso acá se suma siempre, sin condicionar
 * por tratamiento: hacerlo condicional (como pedía la redacción original)
 * dejaría la deuda de una orden INCLUDE_IN_COST subestimada exactamente por
 * el IVA. Si algún día receivePurchaseOrder cambia para respetar el
 * tratamiento en el unitCost del movimiento, esta función hay que revisarla
 * junto con ese cambio — no antes.
 */
export function computeOrderDebt(input: {
  lines: PayableDebtLine[];
  movements: PayableDebtMovement[];
}): number {
  let goodsAndFreight = 0;
  const receivedQtyByProduct = new Map<string, number>();
  for (const movement of input.movements) {
    goodsAndFreight += movement.quantity * movement.unitCost;
    receivedQtyByProduct.set(movement.productId, (receivedQtyByProduct.get(movement.productId) ?? 0) + movement.quantity);
  }

  let tax = 0;
  for (const line of input.lines) {
    const receivedQty = receivedQtyByProduct.get(line.productId) ?? 0;
    tax += receivedQty * line.unitTaxAmount;
  }

  return round2(goodsAndFreight + tax);
}

/* ═══════════════════════════════════════════════════════════════════════
   Consultas
   ═══════════════════════════════════════════════════════════════════════ */

export type PurchaseOrderPayable = {
  purchaseOrderId: string;
  debt: number;
  paid: number;
  balance: number;
  dueDate: Date | null;
  /** Positivo = vencido hace N días; null si no hay dueDate (contado, sin recepción) o balance <= 0. */
  daysOverdue: number | null;
};

async function loadOrderDebtInputs(db: DbClient, purchaseOrderId: string, asOf: Date) {
  const [lines, movements] = await Promise.all([
    db.purchaseOrderLine.findMany({
      where: { purchaseOrderId },
      select: { productId: true, unitTaxAmount: true },
    }),
    // asOf acota "recibido hasta esta fecha" — sin esto, un reporte de un
    // período pasado (Fase 3: payablesOpen "a la fecha de corte") contaría
    // recepciones que todavía no habían pasado en ese momento.
    db.inventoryMovement.findMany({
      where: { referenceType: "PurchaseOrder", referenceId: purchaseOrderId, movementType: "PURCHASE_IN", createdAt: { lte: asOf } },
      select: { productId: true, quantity: true, unitCost: true },
    }),
  ]);
  return {
    lines: lines.map((l) => ({ productId: l.productId, unitTaxAmount: Number(l.unitTaxAmount) })),
    movements: movements.map((m) => ({ productId: m.productId, quantity: Number(m.quantity), unitCost: Number(m.unitCost) })),
  };
}

function computeDaysOverdue(dueDate: Date | null, balance: number, asOf: Date): number | null {
  if (!dueDate || balance <= 0.001) return null;
  const diffMs = asOf.getTime() - dueDate.getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return days > 0 ? days : null;
}

export async function getPurchaseOrderPayable(purchaseOrderId: string, db: DbClient = prisma, asOf: Date = new Date()): Promise<PurchaseOrderPayable> {
  const [po, { lines, movements }, paidAgg] = await Promise.all([
    db.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, select: { dueDate: true } }),
    loadOrderDebtInputs(db, purchaseOrderId, asOf),
    db.treasuryEntry.aggregate({
      where: { purchaseOrderId, direction: "OUT", occurredAt: { lte: asOf } },
      _sum: { amount: true },
    }),
  ]);

  const debt = computeOrderDebt({ lines, movements });
  const paid = round2(Number(paidAgg._sum.amount ?? 0));
  const balance = round2(debt - paid);

  return {
    purchaseOrderId,
    debt,
    paid,
    balance,
    dueDate: po.dueDate,
    daysOverdue: computeDaysOverdue(po.dueDate, balance, asOf),
  };
}

export type SupplierPayableOrder = PurchaseOrderPayable & { orderNumber: string };
export type SupplierPayableSummary = {
  supplierId: string;
  supplierName: string;
  totalDebt: number;
  totalPaid: number;
  totalBalance: number;
  orders: SupplierPayableOrder[];
};

/**
 * Deuda por proveedor, para TODAS sus órdenes con al menos una recepción
 * (deuda > 0) — resuelta con una sola consulta agrupada de
 * InventoryMovement y una sola de TreasuryEntry, nunca una por orden.
 */
export async function listSupplierPayables(
  params: { supplierId?: string; branchId?: string | null; onlyOpen?: boolean; asOf?: Date },
  db: DbClient = prisma,
): Promise<SupplierPayableSummary[]> {
  const asOf = params.asOf ?? new Date();

  const orders = await db.purchaseOrder.findMany({
    where: {
      status: { in: ["APPROVED", "RECEIVED"] },
      supplierId: params.supplierId ? params.supplierId : { not: null },
      date: { lte: asOf },
      ...(params.branchId ? { branchId: params.branchId } : {}),
    },
    select: { id: true, orderNumber: true, dueDate: true, supplierId: true, supplierNameSnapshot: true, supplier: true },
    orderBy: { date: "asc" },
  });
  if (orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);

  const [lineRows, movementRows, paidRows] = await Promise.all([
    db.purchaseOrderLine.findMany({
      where: { purchaseOrderId: { in: orderIds } },
      select: { purchaseOrderId: true, productId: true, unitTaxAmount: true },
    }),
    // asOf acota igual que en getPurchaseOrderPayable — ver ese comentario.
    db.inventoryMovement.findMany({
      where: { referenceType: "PurchaseOrder", referenceId: { in: orderIds }, movementType: "PURCHASE_IN", createdAt: { lte: asOf } },
      select: { referenceId: true, productId: true, quantity: true, unitCost: true },
    }),
    db.treasuryEntry.groupBy({
      by: ["purchaseOrderId"],
      where: { purchaseOrderId: { in: orderIds }, direction: "OUT", occurredAt: { lte: asOf } },
      _sum: { amount: true },
    }),
  ]);

  const linesByOrder = new Map<string, PayableDebtLine[]>();
  for (const row of lineRows) {
    const list = linesByOrder.get(row.purchaseOrderId) ?? [];
    list.push({ productId: row.productId, unitTaxAmount: Number(row.unitTaxAmount) });
    linesByOrder.set(row.purchaseOrderId, list);
  }
  const movementsByOrder = new Map<string, PayableDebtMovement[]>();
  for (const row of movementRows) {
    const list = movementsByOrder.get(row.referenceId) ?? [];
    list.push({ productId: row.productId, quantity: Number(row.quantity), unitCost: Number(row.unitCost) });
    movementsByOrder.set(row.referenceId, list);
  }
  const paidByOrder = new Map(paidRows.map((row) => [row.purchaseOrderId as string, round2(Number(row._sum.amount ?? 0))]));

  const bySupplier = new Map<string, SupplierPayableSummary>();
  for (const order of orders) {
    if (!order.supplierId) continue;
    const debt = computeOrderDebt({
      lines: linesByOrder.get(order.id) ?? [],
      movements: movementsByOrder.get(order.id) ?? [],
    });
    if (debt <= 0) continue;

    const paid = paidByOrder.get(order.id) ?? 0;
    const balance = round2(debt - paid);
    if (params.onlyOpen && balance <= 0.001) continue;

    const orderPayable: SupplierPayableOrder = {
      purchaseOrderId: order.id,
      orderNumber: order.orderNumber,
      debt,
      paid,
      balance,
      dueDate: order.dueDate,
      daysOverdue: computeDaysOverdue(order.dueDate, balance, asOf),
    };

    const existing = bySupplier.get(order.supplierId);
    if (existing) {
      existing.totalDebt = round2(existing.totalDebt + debt);
      existing.totalPaid = round2(existing.totalPaid + paid);
      existing.totalBalance = round2(existing.totalBalance + balance);
      existing.orders.push(orderPayable);
    } else {
      bySupplier.set(order.supplierId, {
        supplierId: order.supplierId,
        supplierName: order.supplierNameSnapshot ?? order.supplier ?? "Proveedor",
        totalDebt: debt,
        totalPaid: paid,
        totalBalance: balance,
        orders: [orderPayable],
      });
    }
  }

  for (const summary of bySupplier.values()) {
    summary.orders.sort((a, b) => {
      if (a.dueDate && b.dueDate) return a.dueDate.getTime() - b.dueDate.getTime();
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    });
  }

  return [...bySupplier.values()].sort((a, b) => b.totalBalance - a.totalBalance);
}
