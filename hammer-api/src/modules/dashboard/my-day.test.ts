import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPendingList, lowStockThreshold, pickLowStock, type LowStockCandidate } from "@/modules/dashboard/my-day";

test("umbral: punto de reorden, luego mínimo, luego 5", () => {
  assert.equal(lowStockThreshold({ reorderPoint: 20, minStock: 10 }), 20);
  assert.equal(lowStockThreshold({ reorderPoint: null, minStock: 10 }), 10);
  assert.equal(lowStockThreshold({ reorderPoint: null, minStock: null }), 5);
  assert.equal(lowStockThreshold(null), 5);
  assert.equal(lowStockThreshold({ reorderPoint: 0, minStock: 10 }), 0);
});

const item = (over: Partial<LowStockCandidate>): LowStockCandidate => ({
  productId: "p", name: "P", unit: "UN", onHand: 1, threshold: 5, soldToday: 1, ...over,
});

test("stock bajo: deja fuera lo que está sobre su umbral y ordena por lo más vendido", () => {
  const out = pickLowStock([
    item({ productId: "sobra", onHand: 30, threshold: 5, soldToday: 50 }),
    item({ productId: "justo", onHand: 5, threshold: 5, soldToday: 2 }),
    item({ productId: "mas-vendido", onHand: 3, threshold: 5, soldToday: 9 }),
    item({ productId: "agotado", onHand: 0, threshold: 5, soldToday: 2 }),
  ]);
  assert.deepEqual(out.map((c) => c.productId), ["mas-vendido", "agotado", "justo"]);
});

test("stock bajo: respeta el límite", () => {
  const many = Array.from({ length: 12 }, (_, i) => item({ productId: `p${i}`, soldToday: i }));
  assert.equal(pickLowStock(many, 8).length, 8);
});

test("pendientes: solo con permiso y con algo que hacer, en orden fijo", () => {
  const out = buildPendingList(
    { payments: 3, myDrafts: 0, dispatches: 2, transports: 1, approvals: 4 },
    { payments: true, myDrafts: true, dispatches: true, transports: false, approvals: true },
  );
  assert.deepEqual(out, [
    { key: "payments", count: 3 },
    { key: "dispatches", count: 2 },
    { key: "approvals", count: 4 },
  ]);
});
