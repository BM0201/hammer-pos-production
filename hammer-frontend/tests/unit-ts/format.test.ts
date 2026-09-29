/**
 * prompt-tesoreria-depositos.md Fase 2 — formatBankAccountOption es el
 * único formato compartido para los selectores de cuenta bancaria, con la
 * moneda SIEMPRE visible.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatBankAccountOption, maskAccountNumber } from "@/lib/format";

describe("maskAccountNumber", () => {
  it("enmascara todo menos los últimos 4 dígitos", () => {
    assert.equal(maskAccountNumber("1234567890"), "····7890");
  });

  it("número de 4 dígitos o menos: se muestra completo, no hay nada que enmascarar", () => {
    assert.equal(maskAccountNumber("1234"), "1234");
    assert.equal(maskAccountNumber("12"), "12");
  });
});

describe("formatBankAccountOption", () => {
  const base = { bankName: "BAC", accountAlias: "Operaciones", accountNumber: "0011224821" };

  it("cuenta NIO: incluye C$ Córdobas", () => {
    const label = formatBankAccountOption({ ...base, currencyCode: "NIO" });
    assert.equal(label, "BAC · Operaciones · ····4821 · C$ Córdobas");
  });

  it("cuenta USD: incluye US$ Dólares, no confundible con NIO", () => {
    const label = formatBankAccountOption({ ...base, accountAlias: "Reserva", accountNumber: "0099119910", currencyCode: "USD" });
    assert.equal(label, "BAC · Reserva · ····9910 · US$ Dólares");
  });

  it("con balance: agrega el saldo en la moneda propia de la cuenta", () => {
    const label = formatBankAccountOption({ ...base, currencyCode: "NIO" }, { balance: 15000.5 });
    assert.equal(label, "BAC · Operaciones · ····4821 · C$ Córdobas · C$15,000.50");
  });

  it("con balance en USD: el símbolo del saldo es US$, no C$", () => {
    const label = formatBankAccountOption({ ...base, currencyCode: "USD" }, { balance: 250 });
    assert.match(label, /US\$250\.00$/);
  });

  it("número corto (menos de 4 dígitos): no rompe, se muestra completo dentro del label", () => {
    const label = formatBankAccountOption({ ...base, accountNumber: "12", currencyCode: "NIO" });
    assert.match(label, /· 12 ·/);
  });
});
