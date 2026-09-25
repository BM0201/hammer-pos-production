/**
 * prompt-pendientes-2026-09.md Fase 2 (PENDIENTES #3) — prellenado del
 * modal de destino al cierre cuando ya hay efectivo pospuesto durante la
 * sesión. Convención del repo: importa la función pura directo del
 * componente (mismo patrón que quickCashAmounts en payment-composer.tsx),
 * sin montar el componente ni JSDOM.
 *
 * Ejecutar: npm run test:unit:logic
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initialDeclarationFromPostponements } from "@/components/cash-session/cash-destination-declaration-modal";

describe("initialDeclarationFromPostponements", () => {
  it("sin posposiciones: retiene todo lo contado, como siempre", () => {
    const result = initialDeclarationFromPostponements(500, []);
    assert.equal(result.retainAmount, 500);
    assert.equal(result.postponedTotal, 0);
  });

  it("pospuesto menor que lo contado: retiene solo lo pospuesto", () => {
    const result = initialDeclarationFromPostponements(500, [{ amount: 200 }]);
    assert.equal(result.retainAmount, 200);
    assert.equal(result.postponedTotal, 200);
  });

  it("pospuesto igual a lo contado: retiene todo", () => {
    const result = initialDeclarationFromPostponements(300, [{ amount: 300 }]);
    assert.equal(result.retainAmount, 300);
    assert.equal(result.postponedTotal, 300);
  });

  it("pospuesto mayor que lo contado: el prefill no puede superar lo contado ahora", () => {
    const result = initialDeclarationFromPostponements(150, [{ amount: 400 }]);
    assert.equal(result.retainAmount, 150);
    assert.equal(result.postponedTotal, 400);
  });

  it("varias posposiciones: suma todas para el prefill", () => {
    const result = initialDeclarationFromPostponements(1000, [{ amount: 120 }, { amount: 80.5 }, { amount: 40 }]);
    assert.equal(result.postponedTotal, 240.5);
    assert.equal(result.retainAmount, 240.5);
  });
});
