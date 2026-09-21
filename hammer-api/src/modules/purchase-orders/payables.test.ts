import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { computeOrderDebt, getPurchaseOrderPayable, listSupplierPayables } from "@/modules/purchase-orders/payables";

/**
 * prompt-cxp.md Fase 1 — computeOrderDebt es la regla central: la deuda de
 * una orden se calcula desde los InventoryMovement PURCHASE_IN reales, no
 * desde PurchaseOrder.total (congelado al crear, no refleja flete real ni
 * recepción parcial).
 *
 * Corrección propia respecto al doc original: se verificó contra
 * receivePurchaseOrder (purchase-orders/service.ts) que el unitCost que
 * realmente se postea al InventoryMovement NUNCA incluye el impuesto — ni
 * con INCLUDE_IN_COST ni con SEPARATE_CREDIT (sale siempre de
 * unitCostBeforeTax + flete/otros cargos del recibo real; la UI de
 * recepción tampoco manda nunca un unitCost distinto). Por eso el impuesto
 * se suma SIEMPRE, sin condicionar por tratamiento — al revés de lo que
 * pedía la redacción original del doc, que hubiera subestimado la deuda de
 * cualquier orden INCLUDE_IN_COST exactamente por el IVA.
 */

test("computeOrderDebt: una recepción simple sin impuesto — deuda = cantidad × unitCost", () => {
  const debt = computeOrderDebt({
    lines: [{ productId: "p1", unitTaxAmount: 0 }],
    movements: [{ productId: "p1", quantity: 10, unitCost: 50 }],
  });
  assert.equal(debt, 500);
});

test("computeOrderDebt: el impuesto se suma siempre, sin importar el tratamiento (INCLUDE_IN_COST no se distingue de SEPARATE_CREDIT en esta función a propósito)", () => {
  // 10 unidades a C$50 (sin IVA) + IVA de C$7.50/unidad (15%) = 500 + 75 = 575,
  // sin importar qué tratamiento declaró la orden — el unitCost del
  // movimiento nunca lo incluye en ninguno de los dos casos reales.
  const debt = computeOrderDebt({
    lines: [{ productId: "p1", unitTaxAmount: 7.5 }],
    movements: [{ productId: "p1", quantity: 10, unitCost: 50 }],
  });
  assert.equal(debt, 575);
});

test("computeOrderDebt: recepción parcial — la deuda es solo de lo efectivamente recibido, no de lo pedido", () => {
  // Orden por 100 unidades, pero solo se recibieron 40.
  const debt = computeOrderDebt({
    lines: [{ productId: "p1", unitTaxAmount: 5 }],
    movements: [{ productId: "p1", quantity: 40, unitCost: 100 }],
  });
  assert.equal(debt, 40 * 100 + 40 * 5); // 4000 + 200 = 4200
});

test("computeOrderDebt: dos recepciones con fletes distintos — la deuda suma AMBAS valuaciones reales, no la del pedido original", () => {
  // Primera recepción: 20 unidades a costo base 100 + flete prorrateado 5 = 105.
  // Segunda recepción (otro camión, otro flete): 30 unidades a costo base 100 + flete prorrateado 8 = 108.
  const debt = computeOrderDebt({
    lines: [{ productId: "p1", unitTaxAmount: 0 }],
    movements: [
      { productId: "p1", quantity: 20, unitCost: 105 },
      { productId: "p1", quantity: 30, unitCost: 108 },
    ],
  });
  assert.equal(debt, 20 * 105 + 30 * 108); // 2100 + 3240 = 5340
});

test("computeOrderDebt: orden aprobada sin recepción (sin movimientos) tiene deuda 0", () => {
  const debt = computeOrderDebt({
    lines: [{ productId: "p1", unitTaxAmount: 10 }],
    movements: [],
  });
  assert.equal(debt, 0);
});

test("computeOrderDebt: varias líneas de productos distintos se calculan independientes y se suman", () => {
  const debt = computeOrderDebt({
    lines: [
      { productId: "p1", unitTaxAmount: 2 },
      { productId: "p2", unitTaxAmount: 3 },
    ],
    movements: [
      { productId: "p1", quantity: 10, unitCost: 20 },
      { productId: "p2", quantity: 5, unitCost: 40 },
    ],
  });
  // p1: 10*20 + 10*2 = 220. p2: 5*40 + 5*3 = 215. Total 435.
  assert.equal(debt, 435);
});

/* ── getPurchaseOrderPayable / listSupplierPayables — fake db ── */

function createFakeDb(input: {
  po?: { dueDate: Date | null };
  lines?: { purchaseOrderId: string; productId: string; unitTaxAmount: number }[];
  movements?: { referenceId: string; productId: string; quantity: number; unitCost: number; createdAt?: Date }[];
  paidByOrder?: Record<string, number>;
  paidEntries?: { purchaseOrderId: string; amount: number; occurredAt: Date }[];
  orders?: { id: string; orderNumber: string; dueDate: Date | null; supplierId: string | null; supplierNameSnapshot: string | null; supplier: string | null }[];
}) {
  const lines = input.lines ?? [];
  const movements = input.movements ?? [];
  // paidEntries es la fixture "fecha-consciente" — paidByOrder sigue andando
  // para los tests que no les importa la fecha (occurredAt lejano en el pasado).
  const paidEntries = input.paidEntries ?? Object.entries(input.paidByOrder ?? {}).map(([purchaseOrderId, amount]) => ({ purchaseOrderId, amount, occurredAt: new Date("2020-01-01T00:00:00Z") }));
  return {
    purchaseOrder: {
      findUniqueOrThrow: async () => input.po,
      findMany: async (args: { where: { date?: { lte: Date } } }) =>
        (input.orders ?? []).filter((o) => !args.where.date || (o as { date?: Date }).date === undefined || (o as { date?: Date }).date! <= args.where.date.lte),
    },
    purchaseOrderLine: {
      findMany: async (args: { where: { purchaseOrderId: string | { in: string[] } } }) => {
        const ids = typeof args.where.purchaseOrderId === "string" ? [args.where.purchaseOrderId] : args.where.purchaseOrderId.in;
        return lines.filter((l) => ids.includes(l.purchaseOrderId)).map((l) => ({ productId: l.productId, unitTaxAmount: new Prisma.Decimal(l.unitTaxAmount) }));
      },
    },
    inventoryMovement: {
      findMany: async (args: { where: { referenceId: string | { in: string[] }; createdAt?: { lte: Date } } }) => {
        const ids = typeof args.where.referenceId === "string" ? [args.where.referenceId] : args.where.referenceId.in;
        return movements
          .filter((m) => ids.includes(m.referenceId))
          .filter((m) => !args.where.createdAt || !m.createdAt || m.createdAt <= args.where.createdAt.lte)
          .map((m) => ({ referenceId: m.referenceId, productId: m.productId, quantity: new Prisma.Decimal(m.quantity), unitCost: new Prisma.Decimal(m.unitCost) }));
      },
    },
    treasuryEntry: {
      aggregate: async (args: { where: { purchaseOrderId: string; occurredAt?: { lte: Date } } }) => {
        const sum = paidEntries
          .filter((e) => e.purchaseOrderId === args.where.purchaseOrderId)
          .filter((e) => !args.where.occurredAt || e.occurredAt <= args.where.occurredAt.lte)
          .reduce((s, e) => s + e.amount, 0);
        return { _sum: { amount: new Prisma.Decimal(sum) } };
      },
      groupBy: async (args: { where: { purchaseOrderId: { in: string[] }; occurredAt?: { lte: Date } } }) => {
        const filtered = paidEntries.filter((e) => args.where.purchaseOrderId.in.includes(e.purchaseOrderId) && (!args.where.occurredAt || e.occurredAt <= args.where.occurredAt.lte));
        const byOrder = new Map<string, number>();
        for (const e of filtered) byOrder.set(e.purchaseOrderId, (byOrder.get(e.purchaseOrderId) ?? 0) + e.amount);
        return [...byOrder.entries()].map(([purchaseOrderId, amount]) => ({ purchaseOrderId, _sum: { amount: new Prisma.Decimal(amount) } }));
      },
    },
  } as unknown as Parameters<typeof getPurchaseOrderPayable>[1];
}

test("getPurchaseOrderPayable: sin pagos, balance = deuda completa", async () => {
  const db = createFakeDb({
    po: { dueDate: new Date("2026-01-15T00:00:00Z") },
    lines: [{ purchaseOrderId: "po1", productId: "p1", unitTaxAmount: 0 }],
    movements: [{ referenceId: "po1", productId: "p1", quantity: 10, unitCost: 100 }],
  });
  const result = await getPurchaseOrderPayable("po1", db);
  assert.equal(result.debt, 1000);
  assert.equal(result.paid, 0);
  assert.equal(result.balance, 1000);
});

test("getPurchaseOrderPayable: con un pago parcial, balance = deuda - pagado", async () => {
  const db = createFakeDb({
    po: { dueDate: new Date("2026-01-15T00:00:00Z") },
    lines: [{ purchaseOrderId: "po1", productId: "p1", unitTaxAmount: 0 }],
    movements: [{ referenceId: "po1", productId: "p1", quantity: 10, unitCost: 100 }],
    paidByOrder: { po1: 400 },
  });
  const result = await getPurchaseOrderPayable("po1", db);
  assert.equal(result.debt, 1000);
  assert.equal(result.paid, 400);
  assert.equal(result.balance, 600);
});

test("getPurchaseOrderPayable: pagada por completo, daysOverdue es null aunque la fecha de vencimiento ya haya pasado", async () => {
  const db = createFakeDb({
    po: { dueDate: new Date("2020-01-01T00:00:00Z") }, // muy vencida
    lines: [{ purchaseOrderId: "po1", productId: "p1", unitTaxAmount: 0 }],
    movements: [{ referenceId: "po1", productId: "p1", quantity: 10, unitCost: 100 }],
    paidByOrder: { po1: 1000 },
  });
  const result = await getPurchaseOrderPayable("po1", db);
  assert.equal(result.balance, 0);
  assert.equal(result.daysOverdue, null, "saldo en 0 no puede estar vencido");
});

test("getPurchaseOrderPayable: daysOverdue cuenta días desde dueDate cuando hay saldo pendiente", async () => {
  const asOf = new Date("2026-01-20T00:00:00Z");
  const db = createFakeDb({
    po: { dueDate: new Date("2026-01-10T00:00:00Z") }, // 10 días antes de asOf
    lines: [{ purchaseOrderId: "po1", productId: "p1", unitTaxAmount: 0 }],
    movements: [{ referenceId: "po1", productId: "p1", quantity: 10, unitCost: 100 }],
  });
  const result = await getPurchaseOrderPayable("po1", db, asOf);
  assert.equal(result.daysOverdue, 10);
});

/**
 * prompt-cxp.md Fase 3 — payablesOpen es "a la fecha de corte", no "a
 * ahora mismo": un reporte de un período pasado no debe verse afectado por
 * una recepción o un pago que ocurrieron DESPUÉS de ese corte.
 */
test("getPurchaseOrderPayable: asOf excluye recepciones posteriores al corte — la deuda es la que había EN ese momento", async () => {
  const asOf = new Date("2026-01-31T23:59:59Z");
  const db = createFakeDb({
    po: { dueDate: new Date("2026-01-10T00:00:00Z") },
    lines: [{ purchaseOrderId: "po1", productId: "p1", unitTaxAmount: 0 }],
    movements: [
      { referenceId: "po1", productId: "p1", quantity: 10, unitCost: 100, createdAt: new Date("2026-01-05T00:00:00Z") }, // dentro del corte
      { referenceId: "po1", productId: "p1", quantity: 5, unitCost: 100, createdAt: new Date("2026-02-10T00:00:00Z") }, // después del corte
    ],
  });
  const result = await getPurchaseOrderPayable("po1", db, asOf);
  assert.equal(result.debt, 1000, "solo la recepción de enero debe contar, no la de febrero");
});

test("getPurchaseOrderPayable: asOf excluye pagos posteriores al corte — el saldo pendiente no baja por un pago que todavía no había pasado", async () => {
  const asOf = new Date("2026-01-31T23:59:59Z");
  const db = createFakeDb({
    po: { dueDate: new Date("2026-01-10T00:00:00Z") },
    lines: [{ purchaseOrderId: "po1", productId: "p1", unitTaxAmount: 0 }],
    movements: [{ referenceId: "po1", productId: "p1", quantity: 10, unitCost: 100, createdAt: new Date("2026-01-05T00:00:00Z") }],
    paidEntries: [{ purchaseOrderId: "po1", amount: 1000, occurredAt: new Date("2026-02-15T00:00:00Z") }], // pago de febrero
  });
  const result = await getPurchaseOrderPayable("po1", db, asOf);
  assert.equal(result.paid, 0, "el pago de febrero no debe contar en un corte de enero");
  assert.equal(result.balance, 1000);
});

test("listSupplierPayables: agrupa por proveedor y suma varias órdenes", async () => {
  const db = createFakeDb({
    orders: [
      { id: "po1", orderNumber: "PO-1", dueDate: new Date("2026-01-10T00:00:00Z"), supplierId: "sup1", supplierNameSnapshot: "Ferretería ACME", supplier: null },
      { id: "po2", orderNumber: "PO-2", dueDate: new Date("2026-01-05T00:00:00Z"), supplierId: "sup1", supplierNameSnapshot: "Ferretería ACME", supplier: null },
    ],
    lines: [
      { purchaseOrderId: "po1", productId: "p1", unitTaxAmount: 0 },
      { purchaseOrderId: "po2", productId: "p1", unitTaxAmount: 0 },
    ],
    movements: [
      { referenceId: "po1", productId: "p1", quantity: 10, unitCost: 100 },
      { referenceId: "po2", productId: "p1", quantity: 5, unitCost: 100 },
    ],
    paidByOrder: { po1: 300 },
  });
  const result = await listSupplierPayables({}, db);
  assert.equal(result.length, 1);
  assert.equal(result[0].supplierId, "sup1");
  assert.equal(result[0].totalDebt, 1500); // 1000 + 500
  assert.equal(result[0].totalPaid, 300);
  assert.equal(result[0].totalBalance, 1200);
  assert.equal(result[0].orders.length, 2);
  // Orden por vencimiento: PO-2 (5 ene) antes que PO-1 (10 ene).
  assert.equal(result[0].orders[0].purchaseOrderId, "po2");
});

test("listSupplierPayables: una orden sin recepción (deuda 0) no aparece en el listado", async () => {
  const db = createFakeDb({
    orders: [
      { id: "po1", orderNumber: "PO-1", dueDate: null, supplierId: "sup1", supplierNameSnapshot: "ACME", supplier: null },
    ],
    lines: [{ purchaseOrderId: "po1", productId: "p1", unitTaxAmount: 0 }],
    movements: [], // sin recepción
  });
  const result = await listSupplierPayables({}, db);
  assert.equal(result.length, 0);
});

test("listSupplierPayables: onlyOpen excluye órdenes ya saldadas por completo", async () => {
  const db = createFakeDb({
    orders: [
      { id: "po1", orderNumber: "PO-1", dueDate: new Date("2026-01-10T00:00:00Z"), supplierId: "sup1", supplierNameSnapshot: "ACME", supplier: null },
    ],
    lines: [{ purchaseOrderId: "po1", productId: "p1", unitTaxAmount: 0 }],
    movements: [{ referenceId: "po1", productId: "p1", quantity: 10, unitCost: 100 }],
    paidByOrder: { po1: 1000 }, // saldada
  });
  const resultAll = await listSupplierPayables({}, db);
  assert.equal(resultAll.length, 1, "sin onlyOpen, la orden saldada igual aparece");

  const resultOpen = await listSupplierPayables({ onlyOpen: true }, db);
  assert.equal(resultOpen.length, 0, "con onlyOpen, una orden con balance 0 no debe listarse");
});
