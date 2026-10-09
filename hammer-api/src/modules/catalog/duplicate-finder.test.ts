import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeForDuplicateMatch,
  diceCoefficient,
  suggestPrimary,
  findDuplicateCandidates,
  dismissedPairKey,
  DUPLICATE_SIMILARITY_THRESHOLD,
  type DuplicateCandidateProduct,
} from "@/modules/catalog/duplicate-finder";

test("normalizeForDuplicateMatch — acentos, mayúsculas y espacios repetidos", () => {
  assert.equal(normalizeForDuplicateMatch("  Cemento   Canál  "), "CEMENTO CANAL");
});

test("normalizeForDuplicateMatch — pulgadas: comilla, PULG, PULGADA(S) terminan igual", () => {
  const expected = "TUBO PVC 1/2IN";
  assert.equal(normalizeForDuplicateMatch('Tubo PVC 1/2"'), expected);
  assert.equal(normalizeForDuplicateMatch("Tubo PVC 1/2 pulg"), expected);
  assert.equal(normalizeForDuplicateMatch("Tubo PVC 1/2 pulgada"), expected);
  assert.equal(normalizeForDuplicateMatch("Tubo PVC 1/2 pulgadas"), expected);
});

test("normalizeForDuplicateMatch — fracción con nombre (media pulgada) se unifica con la numérica", () => {
  assert.equal(normalizeForDuplicateMatch("Tubo PVC media pulgada"), normalizeForDuplicateMatch('Tubo PVC 1/2"'));
});

test("normalizeForDuplicateMatch — número entero de pulgadas (sin fracción)", () => {
  assert.equal(normalizeForDuplicateMatch('Clavo 2"'), normalizeForDuplicateMatch("Clavo 2 pulgadas"));
});

test("diceCoefficient — nombres idénticos (ya normalizados) → 1", () => {
  assert.equal(diceCoefficient("Cemento Canal", "cemento canal"), 1);
});

test("diceCoefficient — mismas palabras en otro orden → 1 (son conjuntos, no secuencias)", () => {
  assert.equal(diceCoefficient("Tubo PVC 1/2 pulgada", 'Tubo 1/2" PVC'), 1);
});

test("diceCoefficient — nombres sin nada en común → 0", () => {
  assert.equal(diceCoefficient("Martillo", "Destornillador"), 0);
});

test("diceCoefficient — parcialmente parecidos: entre 0 y 1", () => {
  const score = diceCoefficient("Cemento Canal 42.5kg", "Cemento Canal 50kg");
  assert.ok(score > 0 && score < 1);
});

function product(overrides: Partial<DuplicateCandidateProduct> & { id: string }): DuplicateCandidateProduct {
  return {
    sku: `SKU-${overrides.id}`,
    name: "Producto",
    categoryId: "cat-1",
    unit: "UN",
    barcode: null,
    totalStock: 0,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

test("suggestPrimary — el que tiene código de barras gana sobre el que no tiene", () => {
  const withCode = product({ id: "a", barcode: "123" });
  const noCode = product({ id: "b", barcode: null });
  assert.equal(suggestPrimary(withCode, noCode), "a");
  assert.equal(suggestPrimary(noCode, withCode), "a");
});

test("suggestPrimary — empatados en código: el de más stock gana", () => {
  const moreStock = product({ id: "a", totalStock: 50 });
  const lessStock = product({ id: "b", totalStock: 5 });
  assert.equal(suggestPrimary(moreStock, lessStock), "a");
});

test("suggestPrimary — empatados en código y stock: el más viejo (createdAt menor) gana", () => {
  const older = product({ id: "a", createdAt: new Date("2025-01-01") });
  const newer = product({ id: "b", createdAt: new Date("2026-01-01") });
  assert.equal(suggestPrimary(older, newer), "a");
});

test("dismissedPairKey — mismo par en cualquier orden da la misma clave", () => {
  assert.equal(dismissedPairKey("x", "y"), dismissedPairKey("y", "x"));
});

test("findDuplicateCandidates — par parecido, misma categoría+unidad: aparece", () => {
  const products = [
    product({ id: "a", name: "Cemento Canal", categoryId: "cat-1", unit: "SACO" }),
    product({ id: "b", name: "cemento canal", categoryId: "cat-1", unit: "SACO" }),
  ];
  const pairs = findDuplicateCandidates(products);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].similarity, 1);
});

test("findDuplicateCandidates — misma categoría pero DISTINTA unidad: no se comparan (bloques separados)", () => {
  const products = [
    product({ id: "a", name: "Cemento Canal", categoryId: "cat-1", unit: "SACO" }),
    product({ id: "b", name: "Cemento Canal", categoryId: "cat-1", unit: "KG" }),
  ];
  assert.equal(findDuplicateCandidates(products).length, 0);
});

test("findDuplicateCandidates — nombres distintos: no aparecen (por debajo del umbral)", () => {
  const products = [
    product({ id: "a", name: "Martillo", categoryId: "cat-1", unit: "UN" }),
    product({ id: "b", name: "Destornillador", categoryId: "cat-1", unit: "UN" }),
  ];
  assert.equal(findDuplicateCandidates(products).length, 0);
});

test("findDuplicateCandidates — un par DESCARTADO por un humano no vuelve a aparecer", () => {
  const products = [
    product({ id: "a", name: "Cemento Canal", categoryId: "cat-1", unit: "SACO" }),
    product({ id: "b", name: "cemento canal", categoryId: "cat-1", unit: "SACO" }),
  ];
  const dismissed = new Set([dismissedPairKey("a", "b")]);
  assert.equal(findDuplicateCandidates(products, dismissed).length, 0);
});

test("findDuplicateCandidates — trae suggestedPrimaryId coherente con suggestPrimary", () => {
  const products = [
    product({ id: "a", name: "Cemento Canal", categoryId: "cat-1", unit: "SACO", barcode: "123" }),
    product({ id: "b", name: "cemento canal", categoryId: "cat-1", unit: "SACO", barcode: null }),
  ];
  const pairs = findDuplicateCandidates(products);
  assert.equal(pairs[0].suggestedPrimaryId, "a");
});

test("DUPLICATE_SIMILARITY_THRESHOLD — queda documentado (0.8), no un número mágico sin nombre", () => {
  assert.equal(DUPLICATE_SIMILARITY_THRESHOLD, 0.8);
});
