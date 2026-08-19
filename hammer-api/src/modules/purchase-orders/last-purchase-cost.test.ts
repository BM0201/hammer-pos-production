import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { getLastPurchaseUnitCostBeforeTax } from "@/modules/purchase-orders/service";

/**
 * Reposición v2 (Fase 1.4): esta función es el fix directo de los dos bugs que
 * motivaron la fusión de motores de reposición:
 *   1. reorder/service.ts pasaba el WAC (con IVA incluido) como si fuera el costo
 *      sin IVA → createPurchaseOrder le volvía a aplicar taxRate → doble IVA.
 *   2. replenishment-draft-service.ts creaba líneas con unitCostBeforeTax: 0 a secas.
 * Estas pruebas confirman que unitCostBeforeTax nunca sale con IVA duplicado
 * (se toma tal cual de PurchaseOrderLine, que YA está separado del IVA) y que
 * nunca es 0 silencioso — si no hay dato, se avisa explícitamente.
 */
function createFakeDb(input: {
  line?: { unitCostBeforeTax: number } | null;
  product?: { averageCost: number | null; globalCost: number | null; lastPurchaseCost: number | null } | null;
}) {
  return {
    purchaseOrderLine: {
      findFirst: async () => (input.line ? { unitCostBeforeTax: new Prisma.Decimal(input.line.unitCostBeforeTax) } : null),
    },
    product: {
      findUnique: async () =>
        input.product
          ? {
              averageCost: input.product.averageCost === null ? null : new Prisma.Decimal(input.product.averageCost),
              globalCost: input.product.globalCost === null ? null : new Prisma.Decimal(input.product.globalCost),
              lastPurchaseCost: input.product.lastPurchaseCost === null ? null : new Prisma.Decimal(input.product.lastPurchaseCost),
            }
          : null,
    },
  } as unknown as Parameters<typeof getLastPurchaseUnitCostBeforeTax>[0];
}

test("getLastPurchaseUnitCostBeforeTax: usa unitCostBeforeTax de la última línea tal cual — sin volver a aplicarle IVA", async () => {
  const db = createFakeDb({ line: { unitCostBeforeTax: 320 } });
  const result = await getLastPurchaseUnitCostBeforeTax(db, "prod-1");
  assert.equal(result.unitCostBeforeTax, 320);
  assert.equal(result.source, "LAST_RECEIVED_LINE");
  assert.equal(result.warning, null);
});

test("getLastPurchaseUnitCostBeforeTax: sin líneas previas, cae a WAC pero avisa explícitamente (nunca silencioso)", async () => {
  const db = createFakeDb({ line: null, product: { averageCost: 111.08, globalCost: null, lastPurchaseCost: null } });
  const result = await getLastPurchaseUnitCostBeforeTax(db, "prod-2");
  assert.equal(result.unitCostBeforeTax, 111.08);
  assert.equal(result.source, "WAC_FALLBACK");
  assert.ok(result.warning && result.warning.length > 0);
});

test("getLastPurchaseUnitCostBeforeTax: sin ninguna referencia de costo, devuelve 0 pero con warning (nunca un 0 silencioso como antes)", async () => {
  const db = createFakeDb({ line: null, product: { averageCost: null, globalCost: null, lastPurchaseCost: null } });
  const result = await getLastPurchaseUnitCostBeforeTax(db, "prod-3");
  assert.equal(result.unitCostBeforeTax, 0);
  assert.equal(result.source, "NONE");
  assert.ok(result.warning && result.warning.length > 0);
});

test("getLastPurchaseUnitCostBeforeTax: prioriza la línea de compra sobre el WAC aunque ambos existan", async () => {
  const db = createFakeDb({ line: { unitCostBeforeTax: 285 }, product: { averageCost: 999, globalCost: null, lastPurchaseCost: null } });
  const result = await getLastPurchaseUnitCostBeforeTax(db, "prod-4");
  assert.equal(result.unitCostBeforeTax, 285);
  assert.equal(result.source, "LAST_RECEIVED_LINE");
});
