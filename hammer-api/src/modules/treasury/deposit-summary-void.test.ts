import assert from "node:assert/strict";
import test from "node:test";
import { getDepositSummary } from "@/modules/treasury/cash-monitor";

/**
 * prompt-tesoreria-depositos.md Fase 3.3 — un depósito anulado (voidBankDeposit)
 * deja de contar en la barra de totales: el monto volvió a custodia, nunca
 * llegó de verdad al banco. `db` inyectable (mismo patrón que
 * getBranchExposureStatus) — acá se le da un fake en memoria que respeta el
 * filtro `voidedAt: null` como lo haría Postgres, sin reimplementar groupBy
 * completo.
 */

type FakeDeposit = { id: string; bankAccountId: string; branchId: string; amount: number; depositedAt: Date; voidedAt: Date | null };

function buildFakeDb(deposits: FakeDeposit[]) {
  const accounts = new Map([["bank-1", { id: "bank-1", bankName: "BAC", accountAlias: "Operaciones", accountNumber: "111", currencyCode: "NIO" }]]);
  const branches = new Map([["branch-1", { id: "branch-1", name: "Masaya" }]]);

  function matches(d: FakeDeposit, where: { depositedAt: { gte: Date; lte: Date }; voidedAt: null }): boolean {
    if (where.voidedAt === null && d.voidedAt !== null) return false;
    return d.depositedAt >= where.depositedAt.gte && d.depositedAt <= where.depositedAt.lte;
  }

  const db = {
    bankDeposit: {
      groupBy: async ({ by, where }: { by: string[]; where: { depositedAt: { gte: Date; lte: Date }; voidedAt: null } }) => {
        const filtered = deposits.filter((d) => matches(d, where));
        const key = by[0] as "bankAccountId" | "branchId";
        const groups = new Map<string, FakeDeposit[]>();
        for (const d of filtered) {
          const k = d[key];
          groups.set(k, [...(groups.get(k) ?? []), d]);
        }
        return Array.from(groups.entries()).map(([groupKey, rows]) => ({
          [key]: groupKey,
          _sum: { amount: rows.reduce((s, r) => s + r.amount, 0) },
          _count: { _all: rows.length },
          _max: { depositedAt: rows.reduce((max, r) => (r.depositedAt > max ? r.depositedAt : max), rows[0].depositedAt) },
        }));
      },
    },
    treasuryAccount: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => accounts.get(id)).filter(Boolean),
    },
    branch: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => branches.get(id)).filter(Boolean),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return db;
}

test("LA QUE IMPORTA — un depósito anulado no cuenta en el total ni en el conteo", async () => {
  const db = buildFakeDb([
    { id: "d1", bankAccountId: "bank-1", branchId: "branch-1", amount: 1000, depositedAt: new Date("2026-01-05"), voidedAt: null },
    { id: "d2", bankAccountId: "bank-1", branchId: "branch-1", amount: 5000, depositedAt: new Date("2026-01-10"), voidedAt: new Date("2026-01-11") },
  ]);

  const summary = await getDepositSummary({ from: new Date("2026-01-01"), to: new Date("2026-01-31") }, db);

  assert.equal(summary.deposited.total, 1000, "el depósito anulado (5000) no debe sumar");
  assert.equal(summary.deposited.count, 1);
  assert.equal(summary.byAccount[0].total, 1000);
});

test("todos los depósitos del período anulados → el resumen queda vacío, no con totales fantasma", async () => {
  const db = buildFakeDb([
    { id: "d1", bankAccountId: "bank-1", branchId: "branch-1", amount: 5000, depositedAt: new Date("2026-01-10"), voidedAt: new Date("2026-01-11") },
  ]);

  const summary = await getDepositSummary({ from: new Date("2026-01-01"), to: new Date("2026-01-31") }, db);

  assert.equal(summary.deposited.total, 0);
  assert.equal(summary.byAccount.length, 0);
});

test("sin depósitos anulados: se comporta como antes, suma todo", async () => {
  const db = buildFakeDb([
    { id: "d1", bankAccountId: "bank-1", branchId: "branch-1", amount: 1000, depositedAt: new Date("2026-01-05"), voidedAt: null },
    { id: "d2", bankAccountId: "bank-1", branchId: "branch-1", amount: 2000, depositedAt: new Date("2026-01-06"), voidedAt: null },
  ]);

  const summary = await getDepositSummary({ from: new Date("2026-01-01"), to: new Date("2026-01-31") }, db);

  assert.equal(summary.deposited.total, 3000);
  assert.equal(summary.deposited.count, 2);
});
