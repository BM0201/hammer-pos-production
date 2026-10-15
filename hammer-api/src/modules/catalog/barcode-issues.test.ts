import assert from "node:assert/strict";
import test from "node:test";
import { detectBarcodeIssues, type BarcodeIssueInput } from "@/modules/catalog/barcode-issues";

function input(overrides: Partial<BarcodeIssueInput> = {}): BarcodeIssueInput {
  return {
    code: "4006381333931",
    kind: "FACTORY",
    productIsActive: true,
    productMergedIntoProductId: null,
    productSku: "FER-0001",
    siblingCount: 1,
    productHasPrimary: true,
    ...overrides,
  };
}

test("un código sano no tiene ningún issue", () => {
  assert.deepEqual(detectBarcodeIssues(input()), []);
});

test("LA QUE IMPORTA — CHECKSUM_INVALID cuando el dígito verificador no cuadra", () => {
  assert.deepEqual(detectBarcodeIssues(input({ code: "4006381333930" })), ["CHECKSUM_INVALID"]);
});

test("PRODUCT_INACTIVE cuando el producto dueño está inactivo", () => {
  assert.deepEqual(detectBarcodeIssues(input({ productIsActive: false })), ["PRODUCT_INACTIVE"]);
});

test("LA QUE IMPORTA — PRODUCT_MERGED: un código vivo en un producto ya unificado (no debería pasar, pero si aparece se reporta)", () => {
  assert.deepEqual(detectBarcodeIssues(input({ productMergedIntoProductId: "p-survivor" })), ["PRODUCT_MERGED"]);
});

test("MULTIPLE_CODES a partir de 3 códigos, no con 2", () => {
  assert.deepEqual(detectBarcodeIssues(input({ siblingCount: 2 })), []);
  assert.deepEqual(detectBarcodeIssues(input({ siblingCount: 3 })), ["MULTIPLE_CODES"]);
  assert.deepEqual(detectBarcodeIssues(input({ siblingCount: 5 })), ["MULTIPLE_CODES"]);
});

test("LA QUE IMPORTA — INTERNAL_SKU_MISMATCH: un HMR- que ya no coincide con el SKU actual", () => {
  const result = detectBarcodeIssues(input({ kind: "INTERNAL", code: "HMR-FER-0001", productSku: "FER-0099" }));
  assert.deepEqual(result, ["INTERNAL_SKU_MISMATCH"]);
});

test("un INTERNAL que SÍ coincide con el SKU actual no tiene ese issue", () => {
  const result = detectBarcodeIssues(input({ kind: "INTERNAL", code: "HMR-FER-0001", productSku: "FER-0001" }));
  assert.deepEqual(result, []);
});

test("un FACTORY/SUPPLIER nunca dispara INTERNAL_SKU_MISMATCH, sin importar el texto del código", () => {
  assert.deepEqual(detectBarcodeIssues(input({ kind: "SUPPLIER", code: "HMR-ALGO-RARO" })), []);
});

test("NO_PRIMARY: el producto dueño no tiene ningún código marcado principal", () => {
  assert.deepEqual(detectBarcodeIssues(input({ productHasPrimary: false })), ["NO_PRIMARY"]);
});

test("LA QUE IMPORTA — una fila puede acumular varios issues a la vez", () => {
  const result = detectBarcodeIssues(input({
    code: "HMR-FER-0001",
    kind: "INTERNAL",
    productSku: "FER-0099",
    productIsActive: false,
    siblingCount: 4,
    productHasPrimary: false,
  }));
  assert.deepEqual([...result].sort(), ["INTERNAL_SKU_MISMATCH", "MULTIPLE_CODES", "NO_PRIMARY", "PRODUCT_INACTIVE"].sort());
});
