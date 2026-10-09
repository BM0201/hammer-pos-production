import assert from "node:assert/strict";
import test from "node:test";
import { resolvePosEnter, looksLikeScannedCode, findExactProductMatch, type PosEnterProduct } from "@/lib/pos-enter-resolution";

/**
 * prompt-codigos-y-duplicados.md Fase 5 — Enter en el buscador del POS
 * agrega el producto EXACTO de un código escaneado, o avisa que no existe
 * — nunca el primer resultado difuso de una búsqueda de texto no relacionada.
 */

function product(overrides: Partial<PosEnterProduct> & { id: string }): PosEnterProduct {
  return { sku: `SKU-${overrides.id}`, barcode: null, barcodes: [], ...overrides };
}

test("looksLikeScannedCode — numérico puro (EAN/UPC)", () => {
  assert.equal(looksLikeScannedCode("7501234567890"), true);
});

test("looksLikeScannedCode — SKU del catálogo (letras-guion-dígitos)", () => {
  assert.equal(looksLikeScannedCode("GEN-0001"), true);
});

test("looksLikeScannedCode — código interno HMR-", () => {
  assert.equal(looksLikeScannedCode("HMR-GEN-0001"), true);
});

test("looksLikeScannedCode — texto con espacio (búsqueda real) NO es código", () => {
  assert.equal(looksLikeScannedCode("Cemento Canal"), false);
  assert.equal(looksLikeScannedCode("Clavo 2 pulgadas"), false);
});

test("looksLikeScannedCode — una sola palabra sin guion ni dígitos NO es código", () => {
  assert.equal(looksLikeScannedCode("Martillo"), false);
  assert.equal(looksLikeScannedCode("cemento"), false);
});

test("findExactProductMatch — por barcode principal", () => {
  const p = product({ id: "p1", barcode: "7501234567890" });
  assert.equal(findExactProductMatch("7501234567890", [p])?.id, "p1");
});

test("findExactProductMatch — por código SECUNDARIO", () => {
  const p = product({ id: "p1", barcode: "111", barcodes: ["111", "222"] });
  assert.equal(findExactProductMatch("222", [p])?.id, "p1");
});

test("findExactProductMatch — por SKU (sin distinguir mayúsculas)", () => {
  const p = product({ id: "p1", sku: "GEN-0001" });
  assert.equal(findExactProductMatch("gen-0001", [p])?.id, "p1");
});

test("findExactProductMatch — sin coincidencia: null", () => {
  const p = product({ id: "p1", sku: "GEN-0001" });
  assert.equal(findExactProductMatch("GEN-9999", [p]), null);
});

test("resolvePosEnter — LA QUE IMPORTA: código exacto en caché → ADD_EXACT, aunque no sea el activo", () => {
  const scanned = product({ id: "p2", barcode: "7501234567890" });
  const other = product({ id: "p1", sku: "ALGO-0001" });
  const result = resolvePosEnter({
    typedText: "7501234567890",
    visibleProducts: [other, scanned],
    activeIndex: 0, // el activo es "other", NO el escaneado
    isListStale: false,
  });
  assert.equal(result.kind, "ADD_EXACT");
  assert.equal((result as { product: PosEnterProduct }).product.id, "p2");
});

test("resolvePosEnter — código SECUNDARIO visible: ADD_EXACT al producto dueño, no al primero", () => {
  const owner = product({ id: "p3", barcode: "111", barcodes: ["111", "999"] });
  const first = product({ id: "p0", sku: "OTRO" });
  const result = resolvePosEnter({ typedText: "999", visibleProducts: [first, owner], activeIndex: 0, isListStale: false });
  assert.equal(result.kind, "ADD_EXACT");
  assert.equal((result as { product: PosEnterProduct }).product.id, "p3");
});

test("resolvePosEnter — SKU exacto visible: ADD_EXACT", () => {
  const p = product({ id: "p4", sku: "FER-0042" });
  const result = resolvePosEnter({ typedText: "FER-0042", visibleProducts: [p], activeIndex: 0, isListStale: false });
  assert.equal(result.kind, "ADD_EXACT");
});

test("resolvePosEnter — código escaneado que NO está en la lista visible: QUERY_BY_CODE, nunca agrega el primero", () => {
  const first = product({ id: "p1", sku: "ALGO-0001" });
  const result = resolvePosEnter({ typedText: "9999999999999", visibleProducts: [first], activeIndex: 0, isListStale: false });
  assert.deepEqual(result, { kind: "QUERY_BY_CODE", code: "9999999999999" });
});

test("resolvePosEnter — código escaneado, lista vacía: QUERY_BY_CODE (no hay nada que agregar igual)", () => {
  const result = resolvePosEnter({ typedText: "9999999999999", visibleProducts: [], activeIndex: 0, isListStale: false });
  assert.equal(result.kind, "QUERY_BY_CODE");
});

test("resolvePosEnter — texto normal con la lista desactualizada (debounce no terminó): WAIT", () => {
  const stale = product({ id: "p-old", name: "de la búsqueda anterior" } as never);
  const result = resolvePosEnter({ typedText: "cemento canal", visibleProducts: [stale], activeIndex: 0, isListStale: true });
  assert.equal(result.kind, "WAIT");
});

test("resolvePosEnter — texto normal, lista YA actualizada: ADD_FUZZY_FIRST (comportamiento de siempre para búsqueda real)", () => {
  const p = product({ id: "p1" });
  const result = resolvePosEnter({ typedText: "cemento canal", visibleProducts: [p], activeIndex: 0, isListStale: false });
  assert.deepEqual(result, { kind: "ADD_FUZZY_FIRST", product: p });
});

test("resolvePosEnter — campo vacío: WAIT (nunca agrega nada)", () => {
  const result = resolvePosEnter({ typedText: "   ", visibleProducts: [product({ id: "p1" })], activeIndex: 0, isListStale: false });
  assert.equal(result.kind, "WAIT");
});
