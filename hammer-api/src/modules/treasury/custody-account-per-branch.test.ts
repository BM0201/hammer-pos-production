import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { findOrCreateCustodyAccountTx } from "@/modules/treasury/service";

/**
 * prompt-tesoreria-custodia-sucursal.md Fase 1.1 (fix) — la custodia pasa
 * de ser una por persona (`CUSTODY-{user}`) a una por (persona, sucursal)
 * (`CUSTODY-{user}-{branchId}`). Antes, la PRIMERA sucursal con la que
 * alguien despachaba fijaba el branchId para siempre; un depósito
 * posterior para otra sucursal cae en esa misma cuenta y el corte de esa
 * segunda sucursal nunca se movía.
 */

type FakeAccount = { id: string; code: string; type: string; branchId: string | null; holderUserId: string };

function buildFakeTx(existingAccounts: FakeAccount[] = []) {
  const accounts = new Map(existingAccounts.map((a) => [a.id, a]));
  const users = new Map([["user-master", { id: "user-master", fullName: "Master" }]]);
  let seq = existingAccounts.length;

  const tx = {
    treasuryAccount: {
      findUnique: async ({ where }: { where: { code: string } }) =>
        [...accounts.values()].find((a) => a.code === where.code) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `custody-${seq}`, ...data } as unknown as FakeAccount;
        accounts.set(row.id, row);
        return row;
      },
    },
    user: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const u = users.get(where.id);
        if (!u) throw new Error(`usuario ${where.id} no encontrado`);
        return u;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { tx: tx as unknown as Prisma.TransactionClient, accounts };
}

test("LA QUE IMPORTA — la misma persona, dos sucursales distintas: dos cuentas de custodia distintas", async () => {
  const { tx, accounts } = buildFakeTx();

  const forBranchA = await findOrCreateCustodyAccountTx(tx, { holderUserId: "user-master", branchId: "branch-A" });
  const forBranchB = await findOrCreateCustodyAccountTx(tx, { holderUserId: "user-master", branchId: "branch-B" });

  assert.notEqual(forBranchA.id, forBranchB.id, "no puede ser la misma cuenta — el efectivo de B no puede compartir custodia con el de A");
  assert.equal(accounts.size, 2);
});

test("la misma persona, la misma sucursal, dos llamadas: reusa la misma cuenta", async () => {
  const { tx, accounts } = buildFakeTx();

  const first = await findOrCreateCustodyAccountTx(tx, { holderUserId: "user-master", branchId: "branch-A" });
  const second = await findOrCreateCustodyAccountTx(tx, { holderUserId: "user-master", branchId: "branch-A" });

  assert.equal(first.id, second.id);
  assert.equal(accounts.size, 1);
});

test("branchId null (central): distinta de cualquier sucursal con nombre — no colisiona con 'CENTRAL' como código de sucursal real", async () => {
  const { tx } = buildFakeTx();

  const central = await findOrCreateCustodyAccountTx(tx, { holderUserId: "user-master", branchId: null });
  assert.equal(central.code, "CUSTODY-user-master-CENTRAL");
});

test("una cuenta LEGACY (código sin sucursal, de antes del fix) no se reusa ni se toca — findOrCreateCustodyAccountTx crea una NUEVA cuenta separada", async () => {
  const legacy: FakeAccount = { id: "custody-legacy-1", code: "CUSTODY-user-master", type: "CUSTODY", branchId: "branch-A", holderUserId: "user-master" };
  const { tx, accounts } = buildFakeTx([legacy]);

  const result = await findOrCreateCustodyAccountTx(tx, { holderUserId: "user-master", branchId: "branch-B" });

  assert.notEqual(result.id, legacy.id, "el código nuevo (con sucursal) no coincide con el legacy — no se confunden");
  assert.equal(accounts.get("custody-legacy-1"), legacy, "la cuenta legacy sigue existiendo tal cual, sin tocar");
  assert.equal(accounts.size, 2);
});
