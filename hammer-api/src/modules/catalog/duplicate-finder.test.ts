import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeForDuplicateMatch,
  diceCoefficient,
  duplicateNameSimilarity,
  suggestPrimary,
  findDuplicateCandidates,
  dismissedPairKey,
  DUPLICATE_SIMILARITY_THRESHOLD,
  type DuplicateCandidateProduct,
} from "@/modules/catalog/duplicate-finder";

test("normalizeForDuplicateMatch — acentos, mayúsculas y espacios repetidos", () => {
  assert.equal(normalizeForDuplicateMatch("  Cemento   Canál  "), "CEMENTO CANAL");
});

test("normalizeForDuplicateMatch — pulgadas: comilla, PULG, PULGADA(S) o nada terminan igual", () => {
  const expected = "TUBO PVC 1/2";
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

test("findDuplicateCandidates — DISTINTA unidad: se sugiere igual (la fusión pide confirmar la unidad)", () => {
  const products = [
    product({ id: "a", name: "Cemento Canal", categoryId: "cat-1", unit: "SACO" }),
    product({ id: "b", name: "Cemento Canal", categoryId: "cat-1", unit: "KG" }),
  ];
  assert.equal(findDuplicateCandidates(products).length, 1);
});

// Caso real 2026-11-06: el mismo galón cargado en Pinturas y en Ferretería con
// las palabras en otro orden y "GL" de más — nunca se comparaban.
test("findDuplicateCandidates — DISTINTA categoría, palabras en otro orden y una de más: aparece", () => {
  const products = [
    product({ id: "pin", name: "FASTYL SUR VERDE OXIDO 1/4 GL", categoryId: "pinturas", unit: "UNIDAD" }),
    product({ id: "fer", name: "SUR FASTYL VERDE OXIDO 1/4", categoryId: "ferreteria", unit: "UNIDAD" }),
  ];
  const pairs = findDuplicateCandidates(products);
  assert.equal(pairs.length, 1);
  assert.ok(pairs[0].similarity > 0.9);
});

test("duplicateNameSimilarity — otra medida, otro color u otra presentación NO son duplicados", () => {
  assert.equal(duplicateNameSimilarity("SUR FASTYL VERDE OXIDO 1/4", "SUR FASTYL VERDE OXIDO GL"), null, "1/4 vs galón");
  assert.equal(duplicateNameSimilarity("FASTYL SUR VERDE OXIDO 1/4 GL", "SUR FASTYL VERDE OXIDO GL"), null, "la palabra de más es una medida");
  assert.equal(duplicateNameSimilarity("SUR FASTYL ROJO OXIDO 1/4", "SUR FASTYL VERDE OXIDO 1/4"), null, "otro color (antes daba 0.8 y se sugería)");
  assert.equal(duplicateNameSimilarity("SUR FASTYL NEGRO 1/4", "SUR FASTYL NEGRO GALON"), null);
  assert.equal(duplicateNameSimilarity("Cemento Canal 42.5kg", "Cemento Canal 50kg"), null);
  assert.equal(duplicateNameSimilarity("SUR FASTYL", "SUR FASTYL ROJO OXIDO GL"), null, "contención con muy poco en común");
});

test("duplicateNameSimilarity — mismo producto: otro orden, palabra de más o error de tipeo", () => {
  assert.equal(duplicateNameSimilarity("SUR FASTYL VERDE OXIDO 1/4", "fastyl sur verde óxido 1/4"), 1);
  assert.ok((duplicateNameSimilarity("SUR FASTYL NEGRO 1/4", "SUR FASTYL NEGRO 1/4 GL") ?? 0) > 0.8);
  assert.ok((duplicateNameSimilarity("SUR FASTYL VERDE OXIDO 1/4", "SUR FASTYL VERDE OXIDOO 1/4") ?? 0) >= 0.8, "OXIDO/OXIDOO");
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

// Detección más profunda (2026-11-09) — casos reales del catálogo que antes se escapaban.
test("duplicateNameSimilarity — plural, abreviatura, P/, comilla y X pegada: mismo producto", () => {
  assert.equal(duplicateNameSimilarity("BISAGRAS PAR 3\"X 3\"", "BISAGRA PAR 3 X 3"), 1, "plural + comilla + X");
  assert.equal(duplicateNameSimilarity("SUR FASTYL NEGRO GALON", "SUR FASTYL NEGRO GL"), 1, "GALON = GL");
  assert.equal(duplicateNameSimilarity("JALADERA P/INODORO", "JALADERA PARA INODORO"), 1, "P/ = PARA");
  assert.equal(duplicateNameSimilarity("TORNILLOS PF 3\" 100 PCS", "TORNILLOS PF 3\" 100PCS"), 1, "100 PCS = 100PCS");
  assert.equal(duplicateNameSimilarity("LLAVE JARDIN 1/2\"", "LLAVE PARA JARDIN 1/2\""), 1, "palabra de relleno");
});

test("duplicateNameSimilarity — tipeos y palabras pegadas", () => {
  assert.ok(duplicateNameSimilarity("PEGAMENTO PCV AZUL AM 1/4 GL", "PEGAMENTO PVC AZUL AM 1/4 GL") !== null, "PCV/PVC");
  assert.ok(duplicateNameSimilarity("MODOLO FAST DRY AZUL BANDERA GL", "MODELO FASTDRY AZUL BANDERA GL") !== null, "MODOLO + FASTDRY");
  assert.ok(duplicateNameSimilarity("CEMENTO HOLCIN 42.5KG", "CEMENTO HOLCIM 42.5 KG") !== null, "HOLCIN/HOLCIM");
});

test("duplicateNameSimilarity — medidas distintas siguen sin ser duplicado", () => {
  assert.equal(duplicateNameSimilarity("CUARTON 2X2X4", "CUARTON 2X4X4"), null, "la medida es una sola palabra");
  assert.equal(duplicateNameSimilarity("BISAGRAS PAR 3 1/2\" X 3 1/2\"", "BISAGRAS PAR 3 1/2\"X 2\""), null);
  assert.equal(duplicateNameSimilarity("TEE LISA PVC 1/2\"", "TEE LISA CPVC 1/2\""), null, "PVC ≠ CPVC");
  assert.equal(duplicateNameSimilarity("CANDADO DOBERMAN 20MM", "CANDADO DOBERMAN 45MM"), null);
  assert.equal(duplicateNameSimilarity("ANTICORROSIVO LANCO GRIS GL", "ANTICORROSIVO LANCO VERDE GL"), null);
});

test("findDuplicateCandidates — confianza y motivo: igual = HIGH, palabra de más = MEDIUM, genérico con varias marcas = LOW", () => {
  const pairs = findDuplicateCandidates([
    product({ id: "a", name: "PEGAMENTO PCV AZUL AM 1/4 GL" }),
    product({ id: "b", name: "PEGAMENTO PVC AZUL AM 1/4 GL" }),
    product({ id: "c", name: "SUR FASTYL VERDE OXIDO 1/4" }),
    product({ id: "d", name: "SUR FASTYL VERDE OXIDO 1/4 GL" }),
    product({ id: "g", name: "BISAGRAS PAR 3\"X 3\"" }),
    product({ id: "h", name: "BISAGRAS TF PAR 3\"X 3\"" }),
    product({ id: "i", name: "BISAGRAS FANAL PAR 3\"X 3\"" }),
  ]);
  const byIds = (x: string, y: string) => pairs.find((p) => [p.productA.id, p.productB.id].sort().join() === [x, y].sort().join());
  assert.equal(byIds("a", "b")?.confidence, "HIGH");
  assert.match(byIds("a", "b")?.reason ?? "", /PCV ≈ PVC/);
  assert.equal(byIds("c", "d")?.confidence, "MEDIUM");
  assert.match(byIds("c", "d")?.reason ?? "", /Solo uno dice: GL/);
  assert.equal(byIds("g", "h")?.confidence, "LOW");
  assert.equal(byIds("g", "i")?.confidence, "LOW");
  assert.equal(pairs[0].confidence, "HIGH", "los seguros primero");
});
