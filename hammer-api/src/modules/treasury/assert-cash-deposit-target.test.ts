import assert from "node:assert/strict";
import test from "node:test";
import { assertCashDepositTargetTx } from "@/modules/treasury/service";

/**
 * prompt-tesoreria-depositos.md Fase 2 (Bug 2) — una sola validación para
 * las 4 rutas que reciben efectivo en córdobas y necesitan una cuenta
 * bancaria destino (depósito directo, confirmación de depósito, envío a
 * custodia, declaración de destino al cierre). Acá se prueba el helper
 * directamente, sin repetir sus 4 casos en cada call site.
 */

type FakeAccount = { id: string; type: string; isActive: boolean; currencyCode: string; bankName: string; accountAlias: string };

function buildFakeTx(account: FakeAccount) {
  const accounts = new Map([[account.id, account]]);
  const tx = {
    treasuryAccount: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const a = accounts.get(where.id);
        if (!a) throw new Error(`fake tx: cuenta ${where.id} no existe`);
        return a;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return tx;
}

const NIO_BANK: FakeAccount = { id: "acc-1", type: "BANK", isActive: true, currencyCode: "NIO", bankName: "BAC", accountAlias: "Operaciones" };

test("cuenta BANK activa en córdobas: se acepta y devuelve la cuenta completa", async () => {
  const tx = buildFakeTx(NIO_BANK);
  const account = await assertCashDepositTargetTx(tx, "acc-1");
  assert.equal(account.id, "acc-1");
  assert.equal(account.currencyCode, "NIO");
});

test("cuenta en dólares: rechazada, con el nombre del banco en el mensaje", async () => {
  const tx = buildFakeTx({ ...NIO_BANK, currencyCode: "USD" });
  await assert.rejects(
    () => assertCashDepositTargetTx(tx, "acc-1"),
    /VALIDATION_ERROR.*BAC.*Operaciones.*dólares/,
  );
});

test("cuenta inactiva: rechazada", async () => {
  const tx = buildFakeTx({ ...NIO_BANK, isActive: false });
  await assert.rejects(
    () => assertCashDepositTargetTx(tx, "acc-1"),
    /VALIDATION_ERROR.*inactiva/,
  );
});

test("cuenta tipo CUSTODY (no bancaria): rechazada", async () => {
  const tx = buildFakeTx({ ...NIO_BANK, type: "CUSTODY" });
  await assert.rejects(
    () => assertCashDepositTargetTx(tx, "acc-1"),
    /VALIDATION_ERROR.*no es bancaria/,
  );
});

test("cuenta tipo SETTLEMENT (no bancaria): rechazada", async () => {
  const tx = buildFakeTx({ ...NIO_BANK, type: "SETTLEMENT" });
  await assert.rejects(
    () => assertCashDepositTargetTx(tx, "acc-1"),
    /VALIDATION_ERROR.*no es bancaria/,
  );
});

test("cuenta tipo SAFE (no bancaria): rechazada", async () => {
  const tx = buildFakeTx({ ...NIO_BANK, type: "SAFE" });
  await assert.rejects(
    () => assertCashDepositTargetTx(tx, "acc-1"),
    /VALIDATION_ERROR.*no es bancaria/,
  );
});
