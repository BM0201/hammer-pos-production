/**
 * Fix sobre 475794a (Fase 3 devoluciones) — GET /api/sales/returns/[id]
 * devuelve refundableAmount como Prisma.Decimal serializado (STRING, ej.
 * "100.00"): con 2+ ítems, sumarlos directo concatenaba en vez de sumar y
 * el modal de ejecución mostraba "Total a reembolsar C$0.00". Importa
 * totalRefundableFromItems directo del componente (mismo patrón que
 * quickCashAmounts en payment-composer.tsx) para probar la suma sin montar
 * el componente ni JSDOM.
 *
 * Ejecutar: npm run test:unit:logic
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { totalRefundableFromItems } from "@/components/sales/sale-return-execute-modal";

describe("totalRefundableFromItems", () => {
  it("0 ítems devuelve 0", () => {
    assert.equal(totalRefundableFromItems([]), 0);
  });

  it("1 ítem con monto string", () => {
    assert.equal(totalRefundableFromItems([{ refundableAmount: "100.00" }]), 100);
  });

  it("3 ítems con montos string suma de verdad, no concatena", () => {
    const total = totalRefundableFromItems([
      { refundableAmount: "100.00" },
      { refundableAmount: "50.25" },
      { refundableAmount: "0.75" },
    ]);
    assert.equal(total, 151);
  });

  it("montos number", () => {
    const total = totalRefundableFromItems([{ refundableAmount: 100 }, { refundableAmount: 50.25 }]);
    assert.equal(total, 150.25);
  });

  it("mezcla number y string", () => {
    const total = totalRefundableFromItems([{ refundableAmount: 100 }, { refundableAmount: "50.25" }]);
    assert.equal(total, 150.25);
  });
});
