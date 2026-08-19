import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { assembleAccountBalances, computeAccountBalance } from "@/modules/treasury/service";

/**
 * H-4 — listBankAccountsWithBalancesAndCards pasó de 2 aggregates + 1
 * findMany POR CUENTA a un solo groupBy(accountId, direction) para todas.
 * assembleAccountBalances ensambla ese groupBy en memoria; esta prueba
 * confirma que da el MISMO número que calcular cuenta por cuenta a mano
 * (equivalente a lo que hacía getTreasuryAccountBalance antes, una por una).
 */
test("assembleAccountBalances: 3 cuentas con IN/OUT mixtos y openingBalance != 0 — mismo saldo que cuenta por cuenta", () => {
  const accounts = [
    { id: "acc-1", openingBalance: 1000, openingBalanceAt: new Date("2026-01-01") },
    { id: "acc-2", openingBalance: 0, openingBalanceAt: new Date("2026-01-01") },
    { id: "acc-3", openingBalance: -250, openingBalanceAt: new Date("2026-01-01") },
  ];

  // Entradas crudas, como si vinieran de treasuryEntry sin agrupar.
  const rawEntries: Array<{ accountId: string; direction: "IN" | "OUT"; amount: number }> = [
    { accountId: "acc-1", direction: "IN", amount: 5000 },
    { accountId: "acc-1", direction: "IN", amount: 200 },
    { accountId: "acc-1", direction: "OUT", amount: 1800 },
    { accountId: "acc-2", direction: "OUT", amount: 300 },
    { accountId: "acc-3", direction: "IN", amount: 900 },
    { accountId: "acc-3", direction: "OUT", amount: 100 },
    { accountId: "acc-3", direction: "OUT", amount: 50 },
  ];

  // Camino A: cuenta por cuenta, como getTreasuryAccountBalance.
  const expected = new Map(
    accounts.map((account) => {
      const totalIn = rawEntries.filter((e) => e.accountId === account.id && e.direction === "IN").reduce((s, e) => s + e.amount, 0);
      const totalOut = rawEntries.filter((e) => e.accountId === account.id && e.direction === "OUT").reduce((s, e) => s + e.amount, 0);
      return [account.id, computeAccountBalance(Number(account.openingBalance), totalIn, totalOut)];
    }),
  );

  // Camino B: un solo groupBy(accountId, direction), como en la vista batch.
  const grouped = new Map<string, number>();
  for (const e of rawEntries) {
    const key = `${e.accountId}:${e.direction}`;
    grouped.set(key, (grouped.get(key) ?? 0) + e.amount);
  }
  const sumRows = Array.from(grouped.entries()).map(([key, sum]) => {
    const [accountId, direction] = key.split(":") as [string, "IN" | "OUT"];
    return { accountId, direction, _sum: { amount: new Prisma.Decimal(sum) } };
  });

  const actual = assembleAccountBalances(accounts, sumRows);

  for (const account of accounts) {
    assert.equal(actual.get(account.id)?.balance, expected.get(account.id), `saldo de ${account.id} debe coincidir`);
  }
});

test("assembleAccountBalances: cuenta sin ningún movimiento usa la apertura tal cual", () => {
  const accounts = [{ id: "acc-vacia", openingBalance: 750, openingBalanceAt: new Date("2026-01-01") }];
  const balances = assembleAccountBalances(accounts, []);
  assert.equal(balances.get("acc-vacia")?.balance, 750);
  assert.equal(balances.get("acc-vacia")?.totalIn, 0);
  assert.equal(balances.get("acc-vacia")?.totalOut, 0);
});

test("assembleAccountBalances: sin openingBalanceAt, pendingOpening queda true", () => {
  const accounts = [{ id: "acc-sin-apertura", openingBalance: 0, openingBalanceAt: null }];
  const balances = assembleAccountBalances(accounts, []);
  assert.equal(balances.get("acc-sin-apertura")?.pendingOpening, true);
});
