import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { getTreasuryAccountLedger } from "@/modules/treasury/service";

/**
 * Fase 4 (prompt-flujo-velocidad.md): getTreasuryAccountLedger pasó de
 * traer TODA la historia de la cuenta y filtrar/acumular en memoria, a
 * empujar el rango de fecha al WHERE + un agregado para el saldo de inicio
 * de rango + paginación. Estas pruebas fijan que el RESULTADO (filas
 * mostradas, saldo de inicio, saldo corriente por fila) es el MISMO que
 * antes — la optimización no puede cambiar lo que el usuario ve, solo cómo
 * se calcula.
 */

const ACCOUNT_ID = "acc-1";
const OPENING_BALANCE = 1000;

type FakeEntry = {
  id: string;
  accountId: string;
  direction: "IN" | "OUT";
  amount: Prisma.Decimal;
  occurredAt: Date;
  createdAt: Date;
};

function createFakeDb(entries: FakeEntry[]) {
  const sorted = [...entries].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));

  function applyWhere(where: { accountId: string; occurredAt?: { gte?: Date; lte?: Date; lt?: Date } }) {
    return sorted.filter((e) => {
      if (e.accountId !== where.accountId) return false;
      if (where.occurredAt?.gte && e.occurredAt < where.occurredAt.gte) return false;
      if (where.occurredAt?.lte && e.occurredAt > where.occurredAt.lte) return false;
      if (where.occurredAt?.lt && e.occurredAt >= where.occurredAt.lt) return false;
      return true;
    });
  }

  return {
    treasuryAccount: {
      findUniqueOrThrow: async () => ({ id: ACCOUNT_ID, openingBalance: new Prisma.Decimal(OPENING_BALANCE) }),
    },
    treasuryEntry: {
      findMany: async (args: { where: { accountId: string; occurredAt?: { gte?: Date; lte?: Date } }; skip?: number; take?: number; select?: unknown }) => {
        const rows = applyWhere(args.where);
        const skipped = rows.slice(args.skip ?? 0, args.take !== undefined ? (args.skip ?? 0) + args.take : undefined);
        return skipped;
      },
      count: async (args: { where: { accountId: string; occurredAt?: { gte?: Date; lte?: Date } } }) => applyWhere(args.where).length,
      aggregate: async (args: { where: { accountId: string; direction: "IN" | "OUT"; occurredAt?: { lt?: Date } } }) => {
        const rows = applyWhere(args.where).filter((e) => e.direction === args.where.direction);
        const sum = rows.reduce((s, e) => s + Number(e.amount), 0);
        return { _sum: { amount: rows.length > 0 ? new Prisma.Decimal(sum) : null } };
      },
    },
  } as unknown as Parameters<typeof getTreasuryAccountLedger>[3];
}

function entry(id: string, direction: "IN" | "OUT", amount: number, occurredAt: string): FakeEntry {
  return { id, accountId: ACCOUNT_ID, direction, amount: new Prisma.Decimal(amount), occurredAt: new Date(occurredAt), createdAt: new Date(occurredAt) };
}

const FIVE_ENTRIES = [
  entry("e1", "IN", 100, "2026-01-01T00:00:00Z"),
  entry("e2", "OUT", 30, "2026-01-02T00:00:00Z"),
  entry("e3", "IN", 200, "2026-01-03T00:00:00Z"),
  entry("e4", "OUT", 50, "2026-01-04T00:00:00Z"),
  entry("e5", "IN", 400, "2026-01-05T00:00:00Z"),
];

test("sin rango ni paginación: todas las filas, saldo de inicio = apertura (igual que antes)", async () => {
  const db = createFakeDb(FIVE_ENTRIES);
  const result = await getTreasuryAccountLedger(ACCOUNT_ID, undefined, undefined, db);
  assert.equal(result.rangeStartBalance, 1000);
  assert.deepEqual(result.rows.map((r) => r.id), ["e1", "e2", "e3", "e4", "e5"]);
  assert.deepEqual(result.rows.map((r) => r.runningBalance), [1100, 1070, 1270, 1220, 1620]);
  assert.equal(result.totalCount, 5);
});

test("con rango from: rangeStartBalance = apertura + delta de lo anterior (agregado, no iteración)", async () => {
  const db = createFakeDb(FIVE_ENTRIES);
  const result = await getTreasuryAccountLedger(ACCOUNT_ID, { from: new Date("2026-01-03T00:00:00Z") }, undefined, db);
  // Antes de from: e1 (+100), e2 (-30) => 1000 + 70 = 1070
  assert.equal(result.rangeStartBalance, 1070);
  assert.deepEqual(result.rows.map((r) => r.id), ["e3", "e4", "e5"]);
  assert.deepEqual(result.rows.map((r) => r.runningBalance), [1270, 1220, 1620]);
});

test("con rango from+to: mismas filas y mismo saldo corriente que filtrando en memoria (comportamiento preservado)", async () => {
  const db = createFakeDb(FIVE_ENTRIES);
  const result = await getTreasuryAccountLedger(
    ACCOUNT_ID,
    { from: new Date("2026-01-02T00:00:00Z"), to: new Date("2026-01-04T00:00:00Z") },
    undefined,
    db,
  );
  assert.equal(result.rangeStartBalance, 1100); // solo e1 antes de from
  assert.deepEqual(result.rows.map((r) => r.id), ["e2", "e3", "e4"]);
  assert.deepEqual(result.rows.map((r) => r.runningBalance), [1070, 1270, 1220]);
});

test("paginación: página 2 sigue mostrando el saldo corriente correcto, sin traer la página 1 completa", async () => {
  const db = createFakeDb(FIVE_ENTRIES);
  const page1 = await getTreasuryAccountLedger(ACCOUNT_ID, undefined, { skip: 0, take: 2 }, db);
  const page2 = await getTreasuryAccountLedger(ACCOUNT_ID, undefined, { skip: 2, take: 2 }, db);
  const page3 = await getTreasuryAccountLedger(ACCOUNT_ID, undefined, { skip: 4, take: 2 }, db);

  assert.deepEqual(page1.rows.map((r) => r.id), ["e1", "e2"]);
  assert.deepEqual(page1.rows.map((r) => r.runningBalance), [1100, 1070]);

  assert.deepEqual(page2.rows.map((r) => r.id), ["e3", "e4"]);
  assert.deepEqual(page2.rows.map((r) => r.runningBalance), [1270, 1220]);

  assert.deepEqual(page3.rows.map((r) => r.id), ["e5"]);
  assert.deepEqual(page3.rows.map((r) => r.runningBalance), [1620]);

  assert.equal(page1.totalCount, 5);
  assert.equal(page2.totalCount, 5);
});

test("paginación combinada con rango: la segunda página del rango sigue partiendo del saldo de inicio del rango, no de la apertura", async () => {
  const db = createFakeDb(FIVE_ENTRIES);
  const result = await getTreasuryAccountLedger(
    ACCOUNT_ID,
    { from: new Date("2026-01-02T00:00:00Z") }, // e2..e5, rangeStartBalance = 1100 (solo e1)
    { skip: 2, take: 2 }, // salta e2, e3 dentro del rango
    db,
  );
  assert.equal(result.rangeStartBalance, 1100, "el saldo de inicio de RANGO no cambia con la página");
  assert.deepEqual(result.rows.map((r) => r.id), ["e4", "e5"]);
  // e2 (-30) => 1070, e3 (+200) => 1270 (saldo de página, no expuesto directo,
  // pero e4 debe partir de ahí): e4 (-50) => 1220, e5 (+400) => 1620
  assert.deepEqual(result.rows.map((r) => r.runningBalance), [1220, 1620]);
});

test("cuenta sin movimientos: rangeStartBalance = apertura, rows vacío", async () => {
  const db = createFakeDb([]);
  const result = await getTreasuryAccountLedger(ACCOUNT_ID, undefined, undefined, db);
  assert.equal(result.rangeStartBalance, 1000);
  assert.deepEqual(result.rows, []);
  assert.equal(result.totalCount, 0);
});
