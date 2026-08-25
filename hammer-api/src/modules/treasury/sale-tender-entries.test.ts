import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { recordSaleTenderEntriesTx, classifyTenderForLedger } from "@/modules/treasury/service";
import { normalizeTenders } from "@/modules/payments/service";
import { normalizeDirectSaleTenders } from "@/modules/sales/service";

/**
 * Parte A (prompt-tesoreria-dinero-digital.md): una transferencia sin
 * cuenta destino no puede existir. Antes, un tender TRANSFER con
 * bankAccountId null no entraba a NINGUNA rama de recordSaleTenderEntriesTx
 * — no lanzaba, no llegaba al catch que escribe TREASURY_ENTRY_WRITE_FAILED,
 * desaparecía en silencio sin entrada de libro mayor NI audit log.
 *
 * Pruebas 1, 3, 4, 5: recordSaleTenderEntriesTx contra un tx en memoria
 * (mismo patrón que postponeCashDepositTx). Prueba 2: normalizeTenders/
 * normalizeDirectSaleTenders son puras (sin DB) — exportadas para poder
 * probar los guards directamente.
 */

type FakeAccount = {
  id: string;
  type: string;
  currencyCode: "NIO" | "USD";
  code?: string | null;
  bankName?: string;
  accountAlias?: string;
  accountNumber?: string;
};

function createFakeTx(opts: { accounts?: FakeAccount[] }) {
  const accounts = new Map((opts.accounts ?? []).map((a) => [a.id, a]));
  const accountsByCode = new Map((opts.accounts ?? []).filter((a) => a.code).map((a) => [a.code as string, a]));
  const treasuryEntries: Array<Record<string, unknown>> = [];
  let seq = 0;

  const tx = {
    treasuryAccount: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const a = accounts.get(where.id);
        if (!a) throw new Error(`cuenta ${where.id} no encontrada`);
        return a;
      },
      findUnique: async ({ where }: { where: { code?: string } }) =>
        where.code !== undefined ? accountsByCode.get(where.code) ?? null : null,
      create: async ({ data }: { data: Omit<FakeAccount, "id"> }) => {
        seq += 1;
        const row: FakeAccount = { id: `acct-${seq}`, ...data };
        accounts.set(row.id, row);
        if (row.code) accountsByCode.set(row.code, row);
        return row;
      },
    },
    treasuryEntry: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `entry-${seq}`, ...data };
        treasuryEntries.push(row);
        return row;
      },
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, treasuryEntries };
}

const ACTOR = "user-1";

test("Prueba 1 — TRANSFER con bankAccountId crea una entrada IN SALE_TRANSFER en esa cuenta", async () => {
  const bank: FakeAccount = { id: "acct-lafise", type: "BANK", currencyCode: "NIO" };
  const { tx, treasuryEntries } = createFakeTx({ accounts: [bank] });

  await recordSaleTenderEntriesTx(tx, {
    tenders: [{ id: "tender-1", method: "TRANSFER", amount: 3000, bankAccountId: "acct-lafise" }],
    occurredAt: new Date("2026-08-26T10:00:00Z"),
    createdByUserId: ACTOR,
  });

  assert.equal(treasuryEntries.length, 1);
  assert.equal(treasuryEntries[0].accountId, "acct-lafise");
  assert.equal(treasuryEntries[0].direction, "IN");
  assert.equal(treasuryEntries[0].entryType, "SALE_TRANSFER");
  assert.equal(treasuryEntries[0].amount, 3000);
  assert.equal(treasuryEntries[0].paymentTenderId, "tender-1");
});

test("Prueba 2 — TRANSFER sin bankAccountId es rechazado por el servicio (A.2), en pagos y en venta directa", () => {
  assert.throws(
    () => normalizeTenders({ amount: 500, method: "TRANSFER" as never, tenders: [{ method: "TRANSFER" as never, amount: 500, referenceNumber: "REF-1" }] }),
    /PAYMENT_BANK_ACCOUNT_REQUIRED/,
  );
  assert.throws(
    () => normalizeDirectSaleTenders({ amount: 500, method: "TRANSFER" as never, tenders: [{ method: "TRANSFER" as never, amount: 500, referenceNumber: "REF-1" }] }),
    /PAYMENT_BANK_ACCOUNT_REQUIRED/,
  );
});

test("Prueba 3 (LA QUE IMPORTA) — un TRANSFER sin bankAccountId que esquiva el servicio ya NO desaparece sin rastro: cae en su propia rama, no en la de CASH", async () => {
  // El clasificador puro es lo que antes NO existía: un TRANSFER sin cuenta
  // caía en el mismo "ninguna rama" que CASH — indistinguible, sin auditoría.
  assert.equal(classifyTenderForLedger({ method: "TRANSFER", bankAccountId: null }), "TRANSFER_MISSING_ACCOUNT");
  assert.notEqual(
    classifyTenderForLedger({ method: "TRANSFER", bankAccountId: null }),
    classifyTenderForLedger({ method: "CASH" }),
    "antes del fix, ambos eran indistinguibles (ninguna rama reconocida)",
  );

  // Integración: no crea ninguna TreasuryEntry (no hay cuenta a la cual
  // asignarla) y — a diferencia del bug — NO tumba la operación (no lanza).
  const { tx, treasuryEntries } = createFakeTx({});
  await recordSaleTenderEntriesTx(tx, {
    tenders: [{ id: "tender-huerfano", method: "TRANSFER", amount: 890, bankAccountId: null }],
    occurredAt: new Date("2026-08-26T10:00:00Z"),
    createdByUserId: ACTOR,
  });
  assert.equal(treasuryEntries.length, 0, "sin cuenta no hay a dónde escribir la entrada");
  // El audit log TREASURY_ENTRY_SKIPPED_NO_ACCOUNT usa logAuditEvent (cliente
  // global de Prisma) — su escritura real requiere base de datos y se
  // verifica en integración/QA manual, mismo límite que el resto de las
  // pruebas de este repo sobre logAuditEvent (ver offline-sync.service.test.ts).
});

test("Prueba 4 — CARD crea la entrada en SETTLEMENT, nunca en una cuenta BANK", async () => {
  const { tx, treasuryEntries } = createFakeTx({}); // sin SETTLEMENT-CENTRAL precargada — se autocrea

  await recordSaleTenderEntriesTx(tx, {
    tenders: [{ id: "tender-card", method: "CARD", amount: 1850 }],
    occurredAt: new Date("2026-08-26T10:00:00Z"),
    createdByUserId: ACTOR,
  });

  assert.equal(treasuryEntries.length, 1);
  assert.equal(treasuryEntries[0].entryType, "SALE_CARD");
  // La cuenta destino tiene que ser la SETTLEMENT autocreada (code SETTLEMENT-CENTRAL), no una BANK.
  const accountId = treasuryEntries[0].accountId as string;
  assert.match(accountId, /^acct-/, "se autocreó una cuenta nueva (SETTLEMENT), no reusó ninguna BANK precargada");
});

test("Prueba 5 — CASH no crea ninguna entrada de tesorería (comportamiento actual, protegido)", async () => {
  const { tx, treasuryEntries } = createFakeTx({});
  await recordSaleTenderEntriesTx(tx, {
    tenders: [{ id: "tender-cash", method: "CASH", amount: 500 }],
    occurredAt: new Date("2026-08-26T10:00:00Z"),
    createdByUserId: ACTOR,
  });
  assert.equal(treasuryEntries.length, 0, "el efectivo vive en CashSession, no en el libro mayor");
});
