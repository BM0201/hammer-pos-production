import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPendingList, rankSoldStock, stockLevel, type SoldStockInput } from "@/modules/dashboard/my-day";

const item = (over: Partial<SoldStockInput>): SoldStockInput => ({
  productId: "p", name: "P", unit: "UN", onHand: 100, soldToday: 1, soldInWindow: 14, reorderPoint: null, ...over,
});

test("alcance: días al ritmo de 14 días y nivel por umbral", () => {
  // 13 bolsas al día durante 14 días, quedan 20: alcanza 1.5 días (antes no salía por tener más de 5).
  const [cemento] = rankSoldStock([item({ onHand: 20, soldToday: 13, soldInWindow: 182 })]);
  assert.equal(cemento.daysOfCover, 1.5);
  assert.equal(cemento.level, "short");
  assert.equal(stockLevel(0, null, null), "out");
  assert.equal(stockLevel(50, 30, 60), "short"); // bajo su punto de reorden aunque alcance
  assert.equal(stockLevel(10, 5, null), "watch");
  assert.equal(stockLevel(10, 20, null), "ok");
  assert.equal(stockLevel(10, null, null), "ok");
});

test("alcance: siempre lista lo vendido hoy, lo más urgente primero", () => {
  const out = rankSoldStock([
    item({ productId: "sobra", onHand: 500, soldInWindow: 14 }),
    item({ productId: "vigilar", onHand: 5, soldInWindow: 14 }),
    item({ productId: "agotado", onHand: 0 }),
    item({ productId: "pedir", onHand: 2, soldInWindow: 14 }),
  ]);
  assert.deepEqual(out.map((c) => c.productId), ["agotado", "pedir", "vigilar", "sobra"]);
  assert.equal(out[0].daysOfCover, 0);
});

test("alcance: respeta el límite", () => {
  const many = Array.from({ length: 12 }, (_, i) => item({ productId: `p${i}` }));
  assert.equal(rankSoldStock(many, 8).length, 8);
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
