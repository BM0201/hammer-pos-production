import assert from "node:assert/strict";
import test from "node:test";
import { getProductPriceHistory } from "@/modules/catalog/price-history";

/**
 * "Historial de precio, como el del WAC" — Parte B.3. Cada escritura de
 * precio ya deja un PRODUCT_PRICE_CHANGED (Parte B.1) — este historial
 * solo lee esos auditLog, no reconstruye nada.
 */
function fakeDb(logs: Array<{ id: string; occurredAt: Date; branchId: string | null; actorUserId: string | null; metadataJson: Record<string, unknown> }>) {
  return {
    auditLog: {
      findMany: async () => logs,
    },
    user: {
      findMany: async () => [{ id: "user-1", username: "operador1", fullName: "Operador Uno" }],
    },
  } as any;
}

test("trae las escrituras de precio en orden, con antes/después, origen y quién", async () => {
  const db = fakeDb([
    {
      id: "log-1", occurredAt: new Date("2026-01-01"), branchId: null, actorUserId: "user-1",
      metadataJson: { field: "standardSalePrice", previousPrice: 30, newPrice: 35, origin: "catalogo" },
    },
    {
      id: "log-2", occurredAt: new Date("2026-01-02"), branchId: "branch-1", actorUserId: "user-1",
      metadataJson: { field: "branchPrice", branchId: "branch-1", previousPrice: null, newPrice: 32, origin: "bandeja_precios" },
    },
  ]);
  const result = await getProductPriceHistory(db, { productId: "prod-1" });
  assert.equal(result.length, 2);
  assert.equal(result[0].field, "standardSalePrice");
  assert.equal(result[0].previousPrice, 30);
  assert.equal(result[0].newPrice, 35);
  assert.equal(result[0].origin, "catalogo");
  assert.equal(result[0].actorName, "Operador Uno");
  assert.equal(result[1].field, "branchPrice");
  assert.equal(result[1].branchId, "branch-1");
});

test("metadataJson ausente o incompleto no revienta — campos quedan null", async () => {
  const db = fakeDb([
    { id: "log-1", occurredAt: new Date("2026-01-01"), branchId: null, actorUserId: null, metadataJson: {} },
  ]);
  const result = await getProductPriceHistory(db, { productId: "prod-1" });
  assert.equal(result[0].previousPrice, null);
  assert.equal(result[0].newPrice, null);
  assert.equal(result[0].actorName, null);
  assert.equal(result[0].field, "standardSalePrice", "default seguro cuando falta el campo");
});
