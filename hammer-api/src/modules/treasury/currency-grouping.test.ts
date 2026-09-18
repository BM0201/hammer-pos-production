import assert from "node:assert/strict";
import test from "node:test";
import { groupBalancesByCurrency } from "@/modules/treasury/service";

/**
 * prompt-tesoreria-cerrar-circuito.md H-6 — getTreasuryPosition sumaba
 * TODAS las filas de un tipo de cuenta sin filtrar por moneda
 * (`rows.reduce((s, r) => s + r.balance, 0)` sobre cuentas NIO y USD
 * mezcladas), exactamente lo que su propio comentario decía que nunca debía
 * pasar. byCurrency sí estaba bien — solo el total mentía.
 */

test("LA QUE IMPORTA — dos monedas en el mismo tipo de cuenta → total null, byCurrency correcto", () => {
  const result = groupBalancesByCurrency([
    { currencyCode: "NIO", balance: 1000 },
    { currencyCode: "USD", balance: 200 },
  ]);
  assert.equal(result.total, null, "sin tasa no se inventa una suma entre monedas distintas");
  assert.deepEqual(result.byCurrency, { NIO: 1000, USD: 200 });
});

test("una sola moneda → total es la suma directa", () => {
  const result = groupBalancesByCurrency([
    { currencyCode: "NIO", balance: 1000 },
    { currencyCode: "NIO", balance: 500 },
  ]);
  assert.equal(result.total, 1500);
  assert.deepEqual(result.byCurrency, { NIO: 1500 });
});

test("sin filas (ningún tipo de cuenta) → total 0, byCurrency vacío", () => {
  const result = groupBalancesByCurrency([]);
  assert.equal(result.total, 0);
  assert.deepEqual(result.byCurrency, {});
});

test("tres monedas → sigue siendo null, no solo el caso de dos", () => {
  const result = groupBalancesByCurrency([
    { currencyCode: "NIO", balance: 100 },
    { currencyCode: "USD", balance: 50 },
    { currencyCode: "EUR", balance: 20 },
  ]);
  assert.equal(result.total, null);
});
