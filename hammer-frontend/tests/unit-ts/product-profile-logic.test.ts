import assert from "node:assert/strict";
import test from "node:test";
import { buildAttentionItems, countOpenBrainDecisions, resolveProfileTab, type AttentionInput } from "@/lib/inventory/product-profile-logic";

test("resolveProfileTab: las 9 pestañas viejas caen en las 6 nuevas", () => {
  assert.equal(resolveProfileTab(null), "general");
  assert.equal(resolveProfileTab("pricing"), "pricing"); // "Cambiar precio" de la Lista
  assert.equal(resolveProfileTab("barcodes"), "barcodes"); // chip de código de la Lista
  assert.equal(resolveProfileTab("wacHistory"), "pricing");
  assert.equal(resolveProfileTab("priceHistory"), "pricing");
  assert.equal(resolveProfileTab("brain"), "activity");
  assert.equal(resolveProfileTab("audit"), "activity");
  assert.equal(resolveProfileTab("movements"), "movements");
  assert.equal(resolveProfileTab("inventado"), "general");
});

test("countOpenBrainDecisions: solo OPEN y MANUAL_REVIEW esperan a alguien", () => {
  assert.equal(countOpenBrainDecisions([{ status: "OPEN" }, { status: "MANUAL_REVIEW" }, { status: "EXECUTED" }, { status: "DISMISSED" }]), 2);
});

const healthy: AttentionInput = {
  branchCode: "RIV", effectiveCost: 342, effectivePrice: 450, marginPercent: 24, hasBarcode: true,
  stockInScope: 84, minQuantity: 40, openBrainDecisions: 0,
};

test("buildAttentionItems: producto sano no pide nada", () => {
  assert.deepEqual(buildAttentionItems(healthy), []);
});

test("buildAttentionItems: cada problema apunta a su pestaña", () => {
  const items = buildAttentionItems({ ...healthy, effectiveCost: null, marginPercent: 13.4, hasBarcode: false, stockInScope: 40, openBrainDecisions: 2 });
  assert.deepEqual(items.map((i) => [i.key, i.tab]), [
    ["no-cost", "pricing"], ["low-margin", "pricing"], ["low-stock", "stock"], ["no-code", "barcodes"], ["brain", "activity"],
  ]);
  assert.match(items[1].label, /13\.4% en RIV/);
});

test("buildAttentionItems: sin precio no habla de margen; margen negativo dice bajo el costo", () => {
  assert.deepEqual(buildAttentionItems({ ...healthy, effectivePrice: null, marginPercent: null }).map((i) => i.key), ["no-price"]);
  assert.match(buildAttentionItems({ ...healthy, marginPercent: -5 })[0].label, /bajo el costo/);
});

test("buildAttentionItems: en Toda la red no juzga costo, precio ni mínimo de una sucursal", () => {
  const items = buildAttentionItems({ ...healthy, branchCode: null, effectiveCost: null, effectivePrice: null, marginPercent: null, stockInScope: 0, hasBarcode: false });
  assert.deepEqual(items.map((i) => i.key), ["no-code"]);
});

test("buildAttentionItems: sin política de mínimo no avisa de stock", () => {
  assert.deepEqual(buildAttentionItems({ ...healthy, stockInScope: 0, minQuantity: null }), []);
});
