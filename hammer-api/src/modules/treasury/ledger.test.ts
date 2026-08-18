import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createTreasuryEntryTx, createInternalTransferTx, computeAccountBalance, applyRunningBalance } from "@/modules/treasury/service";

/**
 * prompt-libro-mayor-tesoreria.md §7 — pruebas 8, 9, 10 (los invariantes
 * verificables del §3) sobre las primitivas REALES del libro mayor
 * (createTreasuryEntryTx/createInternalTransferTx), con un fake tx en
 * memoria — mismo patrón que fusion-test-support.ts / global-cost-update.test.ts.
 */
function createLedgerFakeTx(accounts: Record<string, { currencyCode: "NIO" | "USD" }>) {
  const entries: Array<{
    id: string;
    accountId: string;
    direction: "IN" | "OUT";
    amount: Prisma.Decimal;
    currencyCode: string;
    transferId: string | null;
    entryType: string;
  }> = [];
  let seq = 0;

  const tx = {
    treasuryAccount: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const account = accounts[where.id];
        if (!account) throw new Error(`cuenta ${where.id} no encontrada en fake db`);
        return { id: where.id, currencyCode: account.currencyCode };
      },
    },
    treasuryEntry: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `entry-${seq}`, ...data } as (typeof entries)[number];
        entries.push(row);
        return row;
      },
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, entries };
}

test("Prueba 3 (doc): una entrada nace con currencyCode de SU cuenta, nunca de un valor suelto (invariante 3)", async () => {
  const { tx, entries } = createLedgerFakeTx({ "acc-usd": { currencyCode: "USD" } });
  await createTreasuryEntryTx(tx, {
    accountId: "acc-usd",
    direction: "IN",
    amount: 100,
    entryType: "SALE_TRANSFER",
    counterpartyType: "CUSTOMER",
    createdByUserId: "user-1",
  });
  assert.equal(entries[0].currencyCode, "USD");
});

test("una entrada con monto <= 0 se rechaza", async () => {
  const { tx } = createLedgerFakeTx({ "acc-1": { currencyCode: "NIO" } });
  await assert.rejects(
    () => createTreasuryEntryTx(tx, { accountId: "acc-1", direction: "IN", amount: 0, entryType: "EXPENSE", counterpartyType: "SUPPLIER", createdByUserId: "user-1" }),
    /VALIDATION_ERROR/,
  );
  await assert.rejects(
    () => createTreasuryEntryTx(tx, { accountId: "acc-1", direction: "OUT", amount: -5, entryType: "EXPENSE", counterpartyType: "SUPPLIER", createdByUserId: "user-1" }),
    /VALIDATION_ERROR/,
  );
});

test("Prueba 8 (doc): toda entrada con transferId tiene exactamente una pareja opuesta del mismo monto", async () => {
  const { tx, entries } = createLedgerFakeTx({ "custody-1": { currencyCode: "NIO" }, "bank-1": { currencyCode: "NIO" } });
  const { transferId } = await createInternalTransferTx(tx, {
    fromAccountId: "custody-1",
    toAccountId: "bank-1",
    fromAmount: 32225,
    entryType: "DEPOSIT_CONFIRMED",
    counterpartyType: "INTERNAL",
    createdByUserId: "user-1",
  });

  const pair = entries.filter((e) => e.transferId === transferId);
  assert.equal(pair.length, 2, "debe haber exactamente dos filas con este transferId");
  const [outEntry, inEntry] = pair[0].direction === "OUT" ? [pair[0], pair[1]] : [pair[1], pair[0]];
  assert.equal(outEntry.direction, "OUT");
  assert.equal(inEntry.direction, "IN");
  assert.equal(outEntry.amount.toString(), inEntry.amount.toString(), "mismo monto en las dos patas cuando la moneda coincide");
});

test("Prueba 9 (doc): invariante 2 — ninguna transferencia puede tener la misma cuenta en los dos lados", async () => {
  const { tx } = createLedgerFakeTx({ "acc-1": { currencyCode: "NIO" } });
  await assert.rejects(
    () => createInternalTransferTx(tx, { fromAccountId: "acc-1", toAccountId: "acc-1", fromAmount: 100, entryType: "RECONCILIATION", counterpartyType: "ADJUSTMENT", createdByUserId: "user-1" }),
    /VALIDATION_ERROR/,
  );
});

test("Prueba 10 (doc): invariante 4 — transferencia entre monedas distintas sin toAmount (tipo de cambio aplicado) se rechaza", async () => {
  const { tx } = createLedgerFakeTx({ "acc-nio": { currencyCode: "NIO" }, "acc-usd": { currencyCode: "USD" } });
  await assert.rejects(
    () => createInternalTransferTx(tx, { fromAccountId: "acc-usd", toAccountId: "acc-nio", fromAmount: 100, entryType: "DEPOSIT_CONFIRMED", counterpartyType: "INTERNAL", createdByUserId: "user-1" }),
    /VALIDATION_ERROR/,
  );
});

test("transferencia entre monedas distintas CON toAmount (tasa ya aplicada) sí se permite, con montos distintos en cada pata", async () => {
  const { tx, entries } = createLedgerFakeTx({ "acc-usd": { currencyCode: "USD" }, "acc-nio": { currencyCode: "NIO" } });
  const { transferId } = await createInternalTransferTx(tx, {
    fromAccountId: "acc-usd",
    toAccountId: "acc-nio",
    fromAmount: 100,
    toAmount: 3650, // 100 * 36.5, tasa ya aplicada por el caller
    entryType: "DEPOSIT_CONFIRMED",
    counterpartyType: "INTERNAL",
    createdByUserId: "user-1",
  });
  const pair = entries.filter((e) => e.transferId === transferId);
  const outEntry = pair.find((e) => e.direction === "OUT")!;
  const inEntry = pair.find((e) => e.direction === "IN")!;
  assert.equal(outEntry.amount.toString(), "100");
  assert.equal(inEntry.amount.toString(), "3650");
  assert.equal(outEntry.currencyCode, "USD");
  assert.equal(inEntry.currencyCode, "NIO");
});

test("Prueba 4 (doc): la liquidación del adquirente (OUT SETTLEMENT + IN BANK) comparte transferId, igual que cualquier transferencia interna", async () => {
  const { tx, entries } = createLedgerFakeTx({ "settlement-1": { currencyCode: "NIO" }, "bank-1": { currencyCode: "NIO" } });
  const { transferId } = await createInternalTransferTx(tx, {
    fromAccountId: "settlement-1",
    toAccountId: "bank-1",
    fromAmount: 5000,
    entryType: "CARD_SETTLEMENT",
    counterpartyType: "ACQUIRER",
    createdByUserId: "user-1",
  });
  assert.equal(entries.filter((e) => e.transferId === transferId).length, 2);
  assert.ok(entries.every((e) => e.entryType === "CARD_SETTLEMENT"));
});

/* ── §2.3/§2.4 — el cálculo de saldo, sobre una secuencia armada a mano ── */

test("Prueba 11 (doc): saldo de una cuenta = apertura + IN - OUT, contra una secuencia armada a mano", () => {
  // Apertura 10,000; +32,225 (depósito); -5,000 (gasto); +1,200 (venta).
  assert.equal(computeAccountBalance(10_000, 32_225 + 1_200, 5_000), 38_425);
});

test("computeAccountBalance: sin ningún movimiento, el saldo es la apertura tal cual", () => {
  assert.equal(computeAccountBalance(15_000, 0, 0), 15_000);
});

test("Prueba 12 (doc): dos entradas el mismo día — el orden y el saldo corriente son idénticos en dos cargas seguidas (§2.4)", () => {
  const entries = [
    { direction: "IN" as const, amount: 500, occurredAt: new Date("2026-08-18T10:00:00Z") },
    { direction: "OUT" as const, amount: 200, occurredAt: new Date("2026-08-18T15:00:00Z") },
  ];
  const first = applyRunningBalance(1000, entries);
  const second = applyRunningBalance(1000, entries);
  assert.deepEqual(first.map((r) => r.runningBalance), second.map((r) => r.runningBalance));
  assert.deepEqual(first.map((r) => r.runningBalance), [1500, 1300]);
});

test("Prueba 13 (doc): insertar una entrada con fecha vieja — el saldo corriente se recalcula hacia adelante y el saldo final sigue siendo correcto", () => {
  // Antes de insertar la entrada vieja: dos entradas.
  const before = applyRunningBalance(1000, [
    { direction: "IN" as const, amount: 500 },
    { direction: "OUT" as const, amount: 200 },
  ]);
  assert.deepEqual(before.map((r) => r.runningBalance), [1500, 1300]);

  // Se inserta una entrada "vieja" al PRINCIPIO (ya reordenada por
  // occurredAt por el caller, applyRunningBalance no ordena) — el saldo
  // final (último runningBalance) debe seguir siendo el mismo total neto,
  // solo que las líneas intermedias se corren hacia adelante.
  const after = applyRunningBalance(1000, [
    { direction: "IN" as const, amount: 300 }, // la entrada vieja insertada
    { direction: "IN" as const, amount: 500 },
    { direction: "OUT" as const, amount: 200 },
  ]);
  assert.deepEqual(after.map((r) => r.runningBalance), [1300, 1800, 1600]);
  assert.equal(after[after.length - 1].runningBalance, before[before.length - 1].runningBalance + 300);
});

test("applyRunningBalance: cuenta sin entradas — el saldo corriente es la apertura, lista vacía", () => {
  assert.deepEqual(applyRunningBalance(2500, []), []);
});
