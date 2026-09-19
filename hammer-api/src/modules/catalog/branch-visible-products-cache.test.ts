import assert from "node:assert/strict";
import test from "node:test";
import { getVisibleProductIdsForBranch, clearBranchVisibleProductsCache } from "@/modules/catalog/branch-visible-products-cache";

/**
 * Fase 3 (prompt-flujo-velocidad.md): TTL de 30s sobre el set de productos
 * visibles por sucursal — sin invalidación activa (decisión documentada en
 * el propio módulo). Estas pruebas fijan el comportamiento de caché en sí
 * (no vuelve a consultar dentro del TTL, sí lo hace tras limpiarlo o para
 * otra sucursal), no el contenido de branchProductScopeFilter (ver
 * branch-product-scope.test.ts).
 */

function fakeDb(rows: { id: string }[]) {
  let calls = 0;
  return {
    db: {
      product: {
        findMany: async () => {
          calls += 1;
          return rows;
        },
      },
    } as unknown as Parameters<typeof getVisibleProductIdsForBranch>[1],
    getCalls: () => calls,
  };
}

test("cachea el resultado dentro del TTL: segunda llamada a la misma sucursal no vuelve a consultar", async () => {
  clearBranchVisibleProductsCache();
  const { db, getCalls } = fakeDb([{ id: "p1" }, { id: "p2" }]);

  const first = await getVisibleProductIdsForBranch("branch-mga", db);
  const second = await getVisibleProductIdsForBranch("branch-mga", db);

  assert.deepEqual(first, ["p1", "p2"]);
  assert.deepEqual(second, ["p1", "p2"]);
  assert.equal(getCalls(), 1, "la segunda llamada debe venir del cache, no de una nueva consulta");
});

test("sucursales distintas no comparten entrada de cache", async () => {
  clearBranchVisibleProductsCache();
  const { db, getCalls } = fakeDb([{ id: "p1" }]);

  await getVisibleProductIdsForBranch("branch-mga", db);
  await getVisibleProductIdsForBranch("branch-leon", db);

  assert.equal(getCalls(), 2, "cada sucursal debe disparar su propia consulta la primera vez");
});

test("clearBranchVisibleProductsCache fuerza una consulta nueva", async () => {
  clearBranchVisibleProductsCache();
  const { db, getCalls } = fakeDb([{ id: "p1" }]);

  await getVisibleProductIdsForBranch("branch-mga", db);
  clearBranchVisibleProductsCache();
  await getVisibleProductIdsForBranch("branch-mga", db);

  assert.equal(getCalls(), 2);
});
