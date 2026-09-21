import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { recordAccountPaymentTx } from "@/modules/treasury/service";
import { recordAccountPaymentSchema } from "@/modules/treasury/validators";

/**
 * Pagos salientes desde una cuenta registrada (proveedor/planilla/gasto) —
 * la pieza que faltaba para que "los pagos se hagan DESDE esas cuentas" baje
 * el saldo esperado. Mismo patrón de fake tx en memoria que ledger.test.ts.
 */
type FakeAccount = { id: string; type: "BANK" | "SAFE" | "CUSTODY" | "SETTLEMENT"; isActive: boolean; openingBalance: number; currencyCode: "NIO" | "USD" };
type FakeCard = { id: string; accountId: string; isActive: boolean };
type FakeEntry = { id: string; accountId: string; direction: "IN" | "OUT"; amount: Prisma.Decimal; entryType: string; cardId: string | null; purchaseOrderId: string | null; supplierId: string | null };
type FakePurchaseOrder = { id: string; supplierId: string | null; dueDate: Date | null };
type FakeLine = { purchaseOrderId: string; productId: string; unitTaxAmount: number };
type FakeMovement = { referenceId: string; productId: string; quantity: number; unitCost: number };

function createFakeTx(opts: {
  accounts: FakeAccount[];
  cards?: FakeCard[];
  existingEntries?: Array<{ accountId: string; direction: "IN" | "OUT"; amount: number }>;
  purchaseOrders?: FakePurchaseOrder[];
  lines?: FakeLine[];
  movements?: FakeMovement[];
}) {
  const accounts = new Map(opts.accounts.map((a) => [a.id, a]));
  const cards = new Map((opts.cards ?? []).map((c) => [c.id, c]));
  const purchaseOrders = new Map((opts.purchaseOrders ?? []).map((p) => [p.id, p]));
  const lines = opts.lines ?? [];
  const movements = opts.movements ?? [];
  const entries: FakeEntry[] = [];
  const seeded = opts.existingEntries ?? [];
  const calls: string[] = [];
  let seq = 0;

  const tx = {
    treasuryAccount: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const acc = accounts.get(where.id);
        if (!acc) throw new Error(`cuenta ${where.id} no encontrada`);
        return acc;
      },
    },
    treasuryCard: {
      findUnique: async ({ where }: { where: { id: string } }) => cards.get(where.id) ?? null,
    },
    purchaseOrder: {
      findUnique: async ({ where }: { where: { id: string } }) => purchaseOrders.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const po = purchaseOrders.get(where.id);
        if (!po) throw new Error(`orden ${where.id} no encontrada`);
        return po;
      },
    },
    purchaseOrderLine: {
      findMany: async ({ where }: { where: { purchaseOrderId: string } }) =>
        lines.filter((l) => l.purchaseOrderId === where.purchaseOrderId).map((l) => ({ productId: l.productId, unitTaxAmount: new Prisma.Decimal(l.unitTaxAmount) })),
    },
    inventoryMovement: {
      findMany: async ({ where }: { where: { referenceId: string } }) =>
        movements.filter((m) => m.referenceId === where.referenceId).map((m) => ({ productId: m.productId, quantity: new Prisma.Decimal(m.quantity), unitCost: new Prisma.Decimal(m.unitCost) })),
    },
    treasuryEntry: {
      aggregate: async ({ where }: { where: { accountId?: string; purchaseOrderId?: string; direction: "IN" | "OUT" } }) => {
        calls.push("aggregate");
        if (where.purchaseOrderId) {
          const sum = entries.filter((e) => e.purchaseOrderId === where.purchaseOrderId && e.direction === where.direction).reduce((s, e) => s + Number(e.amount), 0);
          return { _sum: { amount: new Prisma.Decimal(sum) } };
        }
        const created = entries.filter((e) => e.accountId === where.accountId && e.direction === where.direction).reduce((s, e) => s + Number(e.amount), 0);
        const pre = seeded.filter((e) => e.accountId === where.accountId && e.direction === where.direction).reduce((s, e) => s + e.amount, 0);
        return { _sum: { amount: new Prisma.Decimal(created + pre) } };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `entry-${seq}`, ...data } as unknown as FakeEntry;
        entries.push(row);
        return row;
      },
    },
    // Spy del lock de fila: registra "lock" en el mismo orden que "aggregate"
    // para que los tests puedan probar que el lock ocurre ANTES de leer el saldo.
    $queryRaw: async (..._args: unknown[]) => {
      calls.push("lock");
      return [];
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, entries, calls };
}

const BANK: FakeAccount = { id: "bank-1", type: "BANK", isActive: true, openingBalance: 10_000, currencyCode: "NIO" };

test("un pago a proveedor crea UNA fila OUT que baja el saldo de la cuenta", async () => {
  const { tx, entries } = createFakeTx({ accounts: [BANK] });
  const entry = await recordAccountPaymentTx(tx, {
    accountId: "bank-1",
    amount: 2500,
    entryType: "SUPPLIER_PAYMENT",
    counterpartyType: "SUPPLIER",
    counterpartyName: "Ferretería Central",
    createdByUserId: "user-1",
  });
  assert.equal(entries.length, 1);
  assert.equal(entry.direction, "OUT");
  assert.equal(entry.amount.toString(), "2500");
  assert.equal(entry.entryType, "SUPPLIER_PAYMENT");
});

test("un pago con tarjeta ligada a la cuenta deja el rastro cardId", async () => {
  const { tx, entries } = createFakeTx({ accounts: [BANK], cards: [{ id: "card-1", accountId: "bank-1", isActive: true }] });
  await recordAccountPaymentTx(tx, {
    accountId: "bank-1",
    amount: 1000,
    entryType: "EXPENSE",
    counterpartyType: "SUPPLIER",
    cardId: "card-1",
    createdByUserId: "user-1",
  });
  assert.equal(entries[0].cardId, "card-1");
});

test("rechaza una tarjeta que NO pertenece a la cuenta", async () => {
  const { tx } = createFakeTx({ accounts: [BANK], cards: [{ id: "card-otra", accountId: "bank-2", isActive: true }] });
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 100, entryType: "EXPENSE", counterpartyType: "SUPPLIER", cardId: "card-otra", createdByUserId: "u" }),
    /VALIDATION_ERROR/,
  );
});

test("rechaza una tarjeta inactiva", async () => {
  const { tx } = createFakeTx({ accounts: [BANK], cards: [{ id: "card-inact", accountId: "bank-1", isActive: false }] });
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 100, entryType: "EXPENSE", counterpartyType: "SUPPLIER", cardId: "card-inact", createdByUserId: "u" }),
    /VALIDATION_ERROR/,
  );
});

test("no se puede pagar desde una cuenta que no es de banco (custodia/safe/liquidación)", async () => {
  const { tx } = createFakeTx({ accounts: [{ id: "safe-1", type: "SAFE", isActive: true, openingBalance: 99999, currencyCode: "NIO" }] });
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "safe-1", amount: 100, entryType: "EXPENSE", counterpartyType: "SUPPLIER", createdByUserId: "u" }),
    /VALIDATION_ERROR/,
  );
});

test("no se puede pagar desde una cuenta inactiva", async () => {
  const { tx } = createFakeTx({ accounts: [{ ...BANK, isActive: false }] });
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 100, entryType: "EXPENSE", counterpartyType: "SUPPLIER", createdByUserId: "u" }),
    /VALIDATION_ERROR/,
  );
});

test("por defecto, un pago que dejaría el saldo en negativo se rechaza", async () => {
  const { tx } = createFakeTx({ accounts: [{ ...BANK, openingBalance: 1000 }] });
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 1500, entryType: "SUPPLIER_PAYMENT", counterpartyType: "SUPPLIER", createdByUserId: "u" }),
    /VALIDATION_ERROR/,
  );
});

test("con allowNegativeBalance (sobregiro/crédito) sí se permite el saldo negativo", async () => {
  const { tx, entries } = createFakeTx({ accounts: [{ ...BANK, openingBalance: 1000 }] });
  await recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 1500, entryType: "SUPPLIER_PAYMENT", counterpartyType: "SUPPLIER", allowNegativeBalance: true, createdByUserId: "u" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].amount.toString(), "1500");
});

test("el saldo disponible considera IN y OUT previos, no solo la apertura", async () => {
  // apertura 1000 + IN 5000 - OUT 2000 = 4000 disponible; un pago de 3500 pasa.
  const { tx, entries } = createFakeTx({
    accounts: [{ ...BANK, openingBalance: 1000 }],
    existingEntries: [
      { accountId: "bank-1", direction: "IN", amount: 5000 },
      { accountId: "bank-1", direction: "OUT", amount: 2000 },
    ],
  });
  await recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 3500, entryType: "EXPENSE", counterpartyType: "SUPPLIER", createdByUserId: "u" });
  assert.equal(entries.length, 1);
  // pero uno de 4500 excede los 4000 y se rechaza
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 4500, entryType: "EXPENSE", counterpartyType: "SUPPLIER", createdByUserId: "u" }),
    /VALIDATION_ERROR/,
  );
});

test("rechaza monto <= 0", async () => {
  const { tx } = createFakeTx({ accounts: [BANK] });
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 0, entryType: "EXPENSE", counterpartyType: "SUPPLIER", createdByUserId: "u" }),
    /VALIDATION_ERROR/,
  );
});

test("el pago toma el lock de la cuenta antes de leer el saldo", async () => {
  const { tx, calls } = createFakeTx({ accounts: [BANK] });
  await recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 100, entryType: "EXPENSE", counterpartyType: "SUPPLIER", createdByUserId: "u" });
  const lockIndex = calls.indexOf("lock");
  const firstAggregateIndex = calls.indexOf("aggregate");
  assert.notEqual(lockIndex, -1, "el lock debe tomarse");
  assert.notEqual(firstAggregateIndex, -1, "el guard debe leer el saldo");
  assert.ok(lockIndex < firstAggregateIndex, "el lock debe tomarse antes del primer aggregate");
});

test("el lock se toma incluso con allowNegativeBalance", async () => {
  const { tx, calls } = createFakeTx({ accounts: [{ ...BANK, openingBalance: 1000 }] });
  await recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 1500, entryType: "SUPPLIER_PAYMENT", counterpartyType: "SUPPLIER", allowNegativeBalance: true, createdByUserId: "u" });
  assert.ok(calls.includes("lock"), "el lock debe tomarse aunque el guard de saldo se salte con el override");
});

/* ── Cuentas por pagar (prompt-cxp.md, Fase 2) — pago ligado a una orden ── */

const PO_FIXTURE = {
  purchaseOrders: [{ id: "po-1", supplierId: "sup-1", dueDate: new Date("2026-01-15T00:00:00Z") }],
  lines: [{ purchaseOrderId: "po-1", productId: "prod-1", unitTaxAmount: 0 }],
  movements: [{ referenceId: "po-1", productId: "prod-1", quantity: 10, unitCost: 100 }], // deuda = 1000
};

test("un pago ligado a purchaseOrderId guarda purchaseOrderId y el supplierId de la orden (no el que mande el caller)", async () => {
  const { tx, entries } = createFakeTx({ accounts: [{ ...BANK, openingBalance: 10_000 }], ...PO_FIXTURE });
  await recordAccountPaymentTx(tx, {
    accountId: "bank-1",
    amount: 400,
    entryType: "SUPPLIER_PAYMENT",
    counterpartyType: "SUPPLIER",
    purchaseOrderId: "po-1",
    supplierId: "otro-proveedor-que-no-debe-usarse",
    createdByUserId: "u",
  });
  assert.equal(entries[0].purchaseOrderId, "po-1");
  assert.equal(entries[0].supplierId, "sup-1", "el supplierId debe salir de la orden, nunca del valor suelto del caller");
});

test("entryType queda forzado a SUPPLIER_PAYMENT cuando hay purchaseOrderId, sin importar qué mande el caller", async () => {
  const { tx } = createFakeTx({ accounts: [{ ...BANK, openingBalance: 10_000 }], ...PO_FIXTURE });
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 100, entryType: "EXPENSE", counterpartyType: "SUPPLIER", purchaseOrderId: "po-1", createdByUserId: "u" }),
    /VALIDATION_ERROR/,
    "EXPENSE ligado a una orden se rechaza — solo SUPPLIER_PAYMENT puede ligarse",
  );
});

test("rechaza pagar una orden desde una cuenta que no es NIO (D3 — una sola moneda por ahora)", async () => {
  const { tx } = createFakeTx({
    accounts: [{ ...BANK, id: "bank-usd", openingBalance: 10_000, currencyCode: "USD" }],
    ...PO_FIXTURE,
  });
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-usd", amount: 100, entryType: "SUPPLIER_PAYMENT", counterpartyType: "SUPPLIER", purchaseOrderId: "po-1", createdByUserId: "u" }),
    /PURCHASE_PAYMENT_CURRENCY_MISMATCH/,
  );
});

test("rechaza pagar una orden sin recepciones (deuda 0)", async () => {
  const { tx } = createFakeTx({
    accounts: [{ ...BANK, openingBalance: 10_000 }],
    purchaseOrders: [{ id: "po-vacia", supplierId: "sup-1", dueDate: null }],
    lines: [{ purchaseOrderId: "po-vacia", productId: "prod-1", unitTaxAmount: 0 }],
    movements: [], // sin recepción todavía
  });
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 100, entryType: "SUPPLIER_PAYMENT", counterpartyType: "SUPPLIER", purchaseOrderId: "po-vacia", createdByUserId: "u" }),
    /VALIDATION_ERROR/,
  );
});

test("rechaza un pago que supera el saldo pendiente de la orden (PURCHASE_OVERPAYMENT)", async () => {
  const { tx } = createFakeTx({ accounts: [{ ...BANK, openingBalance: 10_000 }], ...PO_FIXTURE });
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 1000.01, entryType: "SUPPLIER_PAYMENT", counterpartyType: "SUPPLIER", purchaseOrderId: "po-1", createdByUserId: "u" }),
    /PURCHASE_OVERPAYMENT/,
  );
});

test("un pago exactamente igual al saldo pendiente (saldar por completo) se acepta", async () => {
  const { tx, entries } = createFakeTx({ accounts: [{ ...BANK, openingBalance: 10_000 }], ...PO_FIXTURE });
  await recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 1000, entryType: "SUPPLIER_PAYMENT", counterpartyType: "SUPPLIER", purchaseOrderId: "po-1", createdByUserId: "u" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].amount.toString(), "1000");
});

test("toma el lock de la orden ANTES de leer su deuda (mismo principio que el lock de cuenta)", async () => {
  const { tx, calls } = createFakeTx({ accounts: [{ ...BANK, openingBalance: 10_000 }], ...PO_FIXTURE });
  await recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 100, entryType: "SUPPLIER_PAYMENT", counterpartyType: "SUPPLIER", purchaseOrderId: "po-1", createdByUserId: "u" });
  // Dos locks en total: cuenta y orden. El segundo lock (orden) debe ocurrir
  // antes del aggregate que lee cuánto se pagó ya de la orden.
  const locks = calls.map((c, i) => (c === "lock" ? i : -1)).filter((i) => i >= 0);
  assert.equal(locks.length, 2, "debe tomar el lock de la cuenta Y el de la orden");
  const poAggregateIndex = calls.lastIndexOf("aggregate"); // el aggregate de la orden es el último (corre después del de la cuenta)
  assert.ok(locks[1] < poAggregateIndex, "el lock de la orden debe tomarse antes de leer cuánto se pagó ya");
});

/**
 * Prueba de concurrencia (prompt-cxp.md, Fase 2: "dos pagos simultáneos
 * contra la misma orden no pueden dejar el saldo negativo. Probalo.").
 * Un fake tx en memoria de un solo hilo no puede reproducir el bloqueo real
 * de dos transacciones de Postgres corriendo en paralelo — lo que SÍ se
 * puede probar acá es la propiedad que hace que ese bloqueo sea seguro: que
 * la segunda llamada, corriendo DESPUÉS de que la primera ya escribió su
 * fila, lee el saldo ACTUALIZADO (no uno obsoleto) y por eso rechaza
 * correctamente una sobrepago — exactamente lo que el FOR UPDATE de
 * PurchaseOrder garantiza que pase en producción (el segundo pago espera a
 * que el primero termine y commitee antes de poder leer).
 */
test("concurrencia: un segundo pago que ve el saldo ya reducido por el primero rechaza si excede lo que realmente queda", async () => {
  const { tx } = createFakeTx({ accounts: [{ ...BANK, openingBalance: 10_000 }], ...PO_FIXTURE }); // deuda 1000

  // Primer pago: 600 de 1000 — deja 400 de saldo.
  await recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 600, entryType: "SUPPLIER_PAYMENT", counterpartyType: "SUPPLIER", purchaseOrderId: "po-1", createdByUserId: "u" });

  // Segundo pago (simula la transacción que esperó el lock y ahora corre):
  // 500 más excedería el saldo real de 400 — debe rechazarse, NO aceptarse
  // como si todavía hubiera 1000 disponibles.
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 500, entryType: "SUPPLIER_PAYMENT", counterpartyType: "SUPPLIER", purchaseOrderId: "po-1", createdByUserId: "u" }),
    /PURCHASE_OVERPAYMENT/,
  );

  // Pero 400 (exactamente lo que queda) sí se acepta.
  await recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 400, entryType: "SUPPLIER_PAYMENT", counterpartyType: "SUPPLIER", purchaseOrderId: "po-1", createdByUserId: "u" });
});

const SCHEMA_BASE = {
  accountId: "cabcdefghijklmnop",
  amount: 100,
  entryType: "SUPPLIER_PAYMENT" as const,
  counterpartyType: "SUPPLIER" as const,
};

test("allowNegativeBalance: true sin overrideReason — el schema rechaza", () => {
  const result = recordAccountPaymentSchema.safeParse({ ...SCHEMA_BASE, allowNegativeBalance: true });
  assert.equal(result.success, false);
});

test("allowNegativeBalance: true con razón de 10+ caracteres — el schema acepta", () => {
  const result = recordAccountPaymentSchema.safeParse({
    ...SCHEMA_BASE,
    allowNegativeBalance: true,
    overrideReason: "sobregiro autorizado por gerencia",
  });
  assert.equal(result.success, true);
});

test("overrideReason presente sin allowNegativeBalance — acepta (es solo una nota, no habilita nada)", () => {
  const result = recordAccountPaymentSchema.safeParse({
    ...SCHEMA_BASE,
    overrideReason: "esto no debería habilitar nada",
  });
  assert.equal(result.success, true);
});

test("purchaseOrderId/supplierId son opcionales — sin ellos, el schema acepta igual (pago sin ligar, comportamiento de siempre)", () => {
  const result = recordAccountPaymentSchema.safeParse(SCHEMA_BASE);
  assert.equal(result.success, true);
});

test("purchaseOrderId debe ser un cuid válido si viene", () => {
  const result = recordAccountPaymentSchema.safeParse({ ...SCHEMA_BASE, purchaseOrderId: "no-es-un-cuid" });
  assert.equal(result.success, false);
});
