import assert from "node:assert/strict";
import test from "node:test";
import {
  rankBarcodeSuggestions,
  findManufacturerSiblings,
  articleNumberDistance,
  wordPrefixMatch,
  isOtherPresentation,
  longestCommonPrefixLength,
  type SuggestionCandidate,
  type ManufacturerSibling,
  type RecentSessionProduct,
} from "@/modules/catalog/barcode-suggestions";

function candidate(overrides: Partial<SuggestionCandidate> = {}): SuggestionCandidate {
  return {
    productId: "cand-1", name: "Producto genérico", sku: "SKU-1", unit: "UN", categoryId: "cat-1",
    hasBarcode: false, isActive: true, isMerged: false, stockInBranch: 0, recentActivity60d: false,
    ...overrides,
  };
}

// ── longestCommonPrefixLength / findManufacturerSiblings ──────────────────

test("longestCommonPrefixLength", () => {
  assert.equal(longestCommonPrefixLength("7441002123", "7441002999"), 7);
  assert.equal(longestCommonPrefixLength("123", "456"), 0);
});

test("LA QUE IMPORTA — findManufacturerSiblings: prefijo común y exige al menos 7 dígitos", () => {
  const siblings: ManufacturerSibling[] = [
    { productId: "p1", barcodeCode: "7441002111113", name: "Pintura A", unit: "GAL", categoryId: "cat-1" }, // 7 en común con el código de prueba
    { productId: "p2", barcodeCode: "1112223334445", name: "Otro", unit: "UN", categoryId: "cat-2" }, // sin nada en común
  ];
  const result = findManufacturerSiblings("7441002999999", siblings);
  assert.equal(result.length, 1);
  assert.equal(result[0].productId, "p1");
  assert.ok(result[0].prefixLength >= 7);
});

test("findManufacturerSiblings: un código no-GTIN (con letras) nunca aporta señal de fabricante", () => {
  const siblings: ManufacturerSibling[] = [{ productId: "p1", barcodeCode: "HMR-FER-0001", name: "X", unit: "UN", categoryId: "c1" }];
  assert.deepEqual(findManufacturerSiblings("HMR-FER-0002", siblings), []);
});

// ── articleNumberDistance ──────────────────────────────────────────────────

test("LA QUE IMPORTA — articleNumberDistance: cerca (<100) vs lejos", () => {
  // prefijo común "1234567" (7 dígitos), cola de 3 dígitos antes del verificador final.
  assert.equal(articleNumberDistance("12345671009", "12345671503", 7), 50);
  assert.ok(articleNumberDistance("12345671009", "12345679999", 7)! >= 100);
});

// ── wordPrefixMatch ────────────────────────────────────────────────────────

test('LA QUE IMPORTA — "lat bla gal" encuentra "Látex Blanco Galón"', () => {
  assert.equal(wordPrefixMatch("lat bla gal", "Látex Blanco Galón"), true);
});

test("wordPrefixMatch: una palabra que no es prefijo de nada, no coincide", () => {
  assert.equal(wordPrefixMatch("lat xyz", "Látex Blanco Galón"), false);
});

// ── isOtherPresentation ────────────────────────────────────────────────────

test("LA QUE IMPORTA — isOtherPresentation: misma familia, otra unidad", () => {
  assert.equal(isOtherPresentation("Pintura Látex Blanco", "CUB", "Pintura Látex Blanco", "GAL"), true);
});

test("isOtherPresentation: misma unidad nunca es 'otra presentación'", () => {
  assert.equal(isOtherPresentation("Pintura Látex Blanco", "GAL", "Pintura Látex Blanco", "GAL"), false);
});

test("isOtherPresentation: nombres distintos con distinta unidad no es 'otra presentación' (no son la misma familia)", () => {
  assert.equal(isOtherPresentation("Clavo de 2 pulgadas", "CJ", "Pintura Látex Blanco", "GAL"), false);
});

// ── rankBarcodeSuggestions — integración de las señales ───────────────────

test("LA QUE IMPORTA — mismo fabricante: candidato que comparte prefijo Y nombre con los hermanos sale primero", () => {
  const siblings: ManufacturerSibling[] = [{ productId: "sib-1", barcodeCode: "7441002111113", name: "Pintura Sello Roca Blanco", unit: "GAL", categoryId: "cat-pinturas" }];
  const candidates: SuggestionCandidate[] = [
    candidate({ productId: "cand-match", name: "Pintura Sello Roca Gris", categoryId: "cat-pinturas" }),
    candidate({ productId: "cand-other", name: "Tornillo autorroscante", categoryId: "cat-ferreteria" }),
  ];
  const result = rankBarcodeSuggestions({ code: "7441002111114", manufacturerSiblings: siblings, recentSessionProducts: [], candidates });
  assert.equal(result[0].productId, "cand-match");
  assert.ok(result[0].reasons.some((r) => r.code === "SAME_MANUFACTURER"));
});

test("código sin señal de fabricante (no-GTIN) igual sugiere por nombre y contexto", () => {
  const candidates: SuggestionCandidate[] = [candidate({ productId: "cand-1", name: "Martillo de uña" })];
  const result = rankBarcodeSuggestions({ code: "HMR-ALGO", query: "martillo", manufacturerSiblings: [], recentSessionProducts: [], candidates });
  assert.equal(result.length, 1);
  assert.ok(result[0].reasons.some((r) => r.code === "SIMILAR_NAME"));
});

test('LA QUE IMPORTA — "lat bla gal" encuentra "Látex Blanco Galón" en el ranking completo', () => {
  const candidates: SuggestionCandidate[] = [
    candidate({ productId: "match", name: "Látex Blanco Galón" }),
    candidate({ productId: "no-match", name: "Clavo de acero" }),
  ];
  const result = rankBarcodeSuggestions({ code: "999999999999999", query: "lat bla gal", manufacturerSiblings: [], recentSessionProducts: [], candidates });
  assert.equal(result[0].productId, "match");
});

test("prefiere sin código y con stock por encima de uno sin esas preferencias", () => {
  const candidates: SuggestionCandidate[] = [
    candidate({ productId: "preferred", name: "Clavo", hasBarcode: false, stockInBranch: 10 }),
    candidate({ productId: "worse", name: "Clavo", hasBarcode: true, stockInBranch: 0 }),
  ];
  const result = rankBarcodeSuggestions({ code: "999999999999999", query: "clavo", manufacturerSiblings: [], recentSessionProducts: [], candidates });
  const preferred = result.find((r) => r.productId === "preferred")!;
  const worse = result.find((r) => r.productId === "worse")!;
  assert.ok(preferred.score > worse.score);
});

test('LA QUE IMPORTA — "otra presentación" queda debajo (mismo nombre, otra unidad que el hermano)', () => {
  const siblings: ManufacturerSibling[] = [{ productId: "sib-1", barcodeCode: "7441002111113", name: "Pintura Látex Blanco", unit: "GAL", categoryId: "cat-pinturas" }];
  const candidates: SuggestionCandidate[] = [
    candidate({ productId: "same-presentation", name: "Pintura Látex Blanco", unit: "GAL", categoryId: "cat-pinturas" }),
    candidate({ productId: "other-presentation", name: "Pintura Látex Blanco", unit: "CUB", categoryId: "cat-pinturas" }),
  ];
  const result = rankBarcodeSuggestions({ code: "7441002111114", manufacturerSiblings: siblings, recentSessionProducts: [], candidates });
  const same = result.find((r) => r.productId === "same-presentation")!;
  const other = result.find((r) => r.productId === "other-presentation")!;
  assert.ok(same.score > other.score);
  assert.ok(other.reasons.some((r) => r.code === "OTHER_PRESENTATION"));
});

test("excluye inactivos y unificados — no suman la preferencia de 'activo'", () => {
  const candidates: SuggestionCandidate[] = [
    candidate({ productId: "active", name: "Clavo", isActive: true, isMerged: false }),
    candidate({ productId: "inactive", name: "Clavo", isActive: false, isMerged: false }),
    candidate({ productId: "merged", name: "Clavo", isActive: true, isMerged: true }),
  ];
  const result = rankBarcodeSuggestions({ code: "999999999999999", query: "clavo", manufacturerSiblings: [], recentSessionProducts: [], candidates });
  const active = result.find((r) => r.productId === "active")!;
  const inactive = result.find((r) => r.productId === "inactive")!;
  const merged = result.find((r) => r.productId === "merged")!;
  assert.ok(active.score > inactive.score);
  assert.ok(active.score > merged.score);
});

test("LA QUE IMPORTA — contexto de sesión: misma categoría que el último vinculado suma, y nunca más de 5 sugerencias", () => {
  const recent: RecentSessionProduct[] = [{ productId: "last", name: "Pintura Látex Blanco", categoryId: "cat-pinturas", unit: "GAL" }];
  const candidates: SuggestionCandidate[] = Array.from({ length: 8 }, (_, i) =>
    candidate({ productId: `c${i}`, name: `Producto ${i}`, categoryId: i < 2 ? "cat-pinturas" : "cat-otro", stockInBranch: 1 }));
  const result = rankBarcodeSuggestions({ code: "999999999999999", manufacturerSiblings: [], recentSessionProducts: recent, candidates });
  assert.ok(result.length <= 5);
  assert.ok(result.some((r) => r.productId === "c0" || r.productId === "c1"), "los de la misma categoría del anterior deberían rankear");
});
