import assert from "node:assert/strict";
import test from "node:test";
import { matchesAllTokens, tokenize } from "@/lib/product-search";

/**
 * prompt-codigos-y-duplicados.md Fase 1 — la búsqueda offline del POS
 * también debe encontrar un producto por un código SECUNDARIO (otro
 * proveedor, empaque nuevo), no solo por el principal (`barcode`).
 */

test("matchesAllTokens — encuentra por el barcode principal (comportamiento previo intacto)", () => {
  const item = { name: "Cemento", sku: "MAD-0001", barcode: "7501234567890" };
  assert.equal(matchesAllTokens(item, tokenize("7501234567890")), true);
});

test("matchesAllTokens — encuentra por un código SECUNDARIO (barcodes[])", () => {
  const item = { name: "Tornillo caja", sku: "FER-0100", barcode: "1000000000000", barcodes: ["1000000000000", "2000000000000"] };
  assert.equal(matchesAllTokens(item, tokenize("2000000000000")), true);
});

test("matchesAllTokens — sin barcodes[] (producto sin códigos secundarios): sigue funcionando igual", () => {
  const item = { name: "Clavo", sku: "FER-0042", barcode: null };
  assert.equal(matchesAllTokens(item, tokenize("FER-0042")), true);
  assert.equal(matchesAllTokens(item, tokenize("no-existe")), false);
});
