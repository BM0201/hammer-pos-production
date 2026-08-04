import assert from "node:assert/strict";
import test from "node:test";
import {
  tokenize,
  buildProductSearchWhere,
  rankProductMatches,
  groupProductsByFamily,
} from "./product-search";

// ═══════════════════════════════════════════════════════════════════════════
// tokenize
// ═══════════════════════════════════════════════════════════════════════════

test("tokenize: parte por espacios y normaliza a mayúsculas", () => {
  assert.deepEqual(tokenize("LIJA METAL"), ["LIJA", "METAL"]);
  assert.deepEqual(tokenize("lija metal"), ["LIJA", "METAL"]);
});

test("tokenize: recorta espacios sobrantes y colapsa espacios múltiples", () => {
  assert.deepEqual(tokenize("  lija   metal  "), ["LIJA", "METAL"]);
});

test("tokenize: descarta vacíos", () => {
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize("   "), []);
});

test("tokenize: una sola palabra produce un solo token", () => {
  assert.deepEqual(tokenize("LADRILLO"), ["LADRILLO"]);
});

// ═══════════════════════════════════════════════════════════════════════════
// buildProductSearchWhere
// ═══════════════════════════════════════════════════════════════════════════

test("buildProductSearchWhere: query vacía produce where vacío (sin filtrar)", () => {
  assert.deepEqual(buildProductSearchWhere("", ["sku", "name"]), {});
  assert.deepEqual(buildProductSearchWhere("   ", ["sku", "name"]), {});
});

test("buildProductSearchWhere: un token exige el campo en al menos uno de los fields", () => {
  const where = buildProductSearchWhere("ladrillo", ["sku", "name", "barcode"]);
  assert.deepEqual(where, {
    AND: [
      {
        OR: [
          { sku: { contains: "LADRILLO", mode: "insensitive" } },
          { name: { contains: "LADRILLO", mode: "insensitive" } },
          { barcode: { contains: "LADRILLO", mode: "insensitive" } },
        ],
      },
    ],
  });
});

test("buildProductSearchWhere: dos tokens producen un AND de dos OR — cada palabra puede matchear en un campo distinto", () => {
  const where = buildProductSearchWhere("LIJA METAL", ["sku", "name"]) as { AND: unknown[] };
  assert.equal(where.AND.length, 2);
  assert.deepEqual(where.AND[0], {
    OR: [
      { sku: { contains: "LIJA", mode: "insensitive" } },
      { name: { contains: "LIJA", mode: "insensitive" } },
    ],
  });
  assert.deepEqual(where.AND[1], {
    OR: [
      { sku: { contains: "METAL", mode: "insensitive" } },
      { name: { contains: "METAL", mode: "insensitive" } },
    ],
  });
});

test("buildProductSearchWhere: soporta campos anidados tipo category.name", () => {
  const where = buildProductSearchWhere("ferreteria", ["category.name"]) as { AND: unknown[] };
  assert.deepEqual(where.AND[0], {
    OR: [{ category: { name: { contains: "FERRETERIA", mode: "insensitive" } } }],
  });
});

test("buildProductSearchWhere: producción usa 'code' en vez de 'sku'/'barcode'", () => {
  const where = buildProductSearchWhere("ACERO", ["name", "code"]) as { AND: unknown[] };
  assert.deepEqual(where.AND[0], {
    OR: [
      { name: { contains: "ACERO", mode: "insensitive" } },
      { code: { contains: "ACERO", mode: "insensitive" } },
    ],
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// rankProductMatches
// ═══════════════════════════════════════════════════════════════════════════

type FakeProduct = { name: string; sku: string; category?: { name: string } | null };

function p(name: string, sku: string, categoryName?: string): FakeProduct {
  return { name, sku, category: categoryName ? { name: categoryName } : null };
}

test("rankProductMatches: caso real — 'LIJA METAL' encuentra y prioriza correctamente 'LIJA 3M #150 METAL'", () => {
  const products = [
    p("Anticorrosivo Metal Gris", "AC-001", "Pinturas"),
    p("Lija 3M #150 Metal", "LJ-150", "Ferretería"),
    p("Cemento Gris", "CM-001", "Materiales"),
  ];
  const ranked = rankProductMatches(products, "LIJA METAL");
  assert.equal(ranked[0].name, "Lija 3M #150 Metal");
});

test("rankProductMatches: variante con otra marca/número en medio también matchea", () => {
  const products = [p("Lija Truper #80 Metal", "LJ-080", "Ferretería")];
  const ranked = rankProductMatches(products, "LIJA METAL");
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].name, "Lija Truper #80 Metal");
});

test("rankProductMatches: 'empieza con' rankea antes que 'contiene en medio'", () => {
  const startsWith = p("Ladrillo de Barro", "LB-001");
  const containsInMiddle = p("Bloque Ladrillo Rojo", "BL-001");
  const ranked = rankProductMatches([containsInMiddle, startsWith], "Ladrillo");
  assert.equal(ranked[0].name, "Ladrillo de Barro");
  assert.equal(ranked[1].name, "Bloque Ladrillo Rojo");
});

test("rankProductMatches: match por categoría queda al final, detrás de los que matchean por nombre", () => {
  const byName = p("Ladrillo Cuarterón", "LD-001", "Materiales");
  const byCategoryOnly = p("Bloque de Cemento", "BC-001", "Ladrillo y Bloques");
  const ranked = rankProductMatches([byCategoryOnly, byName], "LADRILLO");
  assert.equal(ranked[0].name, "Ladrillo Cuarterón");
  assert.equal(ranked[1].name, "Bloque de Cemento");
});

test("rankProductMatches: dentro del mismo rango, desempata alfabéticamente", () => {
  const b = p("Ladrillo Barro Rojo", "LB-002");
  const a = p("Ladrillo Amarillo", "LA-001");
  const ranked = rankProductMatches([b, a], "Ladrillo");
  assert.equal(ranked[0].name, "Ladrillo Amarillo");
  assert.equal(ranked[1].name, "Ladrillo Barro Rojo");
});

test("rankProductMatches: búsqueda de una sola palabra sigue funcionando (regresión)", () => {
  const products = [p("Cemento Canal", "CM-002"), p("Ladrillo Cuarterón", "LD-001")];
  const ranked = rankProductMatches(products, "Ladrillo");
  assert.equal(ranked[0].name, "Ladrillo Cuarterón");
});

test("rankProductMatches: query vacía no reordena", () => {
  const products = [p("Zapata", "Z-1"), p("Arena", "A-1")];
  assert.deepEqual(rankProductMatches(products, ""), products);
});

// ═══════════════════════════════════════════════════════════════════════════
// groupProductsByFamily
// ═══════════════════════════════════════════════════════════════════════════

test("groupProductsByFamily: agrupa 3+ productos 'Ladrillo' separados de los que matchean solo por categoría", () => {
  const products = [
    p("Ladrillo Cuarterón", "LD-001", "Materiales"),
    p("Ladrillo Amarillo", "LD-002", "Materiales"),
    p("Ladrillo de Barro", "LD-003", "Materiales"),
    p("Bloque de Cemento", "BC-001", "Ladrillo y Bloques"),
  ];
  const groups = groupProductsByFamily(products);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].family, "Ladrillo");
  assert.equal(groups[0].items.length, 3);
  assert.equal(groups[1].family, "Otras coincidencias");
  assert.equal(groups[1].items.length, 1);
  assert.equal(groups[1].items[0].name, "Bloque de Cemento");
});

test("groupProductsByFamily: sin coincidencias ajenas, no aparece 'Otras coincidencias'", () => {
  const products = [p("Lija 3M #150 Metal", "LJ-150"), p("Lija Truper #80 Metal", "LJ-080")];
  const groups = groupProductsByFamily(products);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].family, "Lija");
});

test("groupProductsByFamily: family conserva Title Case sin importar el casing original", () => {
  const groups = groupProductsByFamily([p("LIJA 3M #150 METAL", "LJ-150")]);
  assert.equal(groups[0].family, "Lija");
});

test("groupProductsByFamily: lista vacía produce lista de grupos vacía", () => {
  assert.deepEqual(groupProductsByFamily([]), []);
});

test("groupProductsByFamily: también resuelve la categoría cuando viene aplanada como categoryName (camino POS con branchId)", () => {
  // mapSingleProductWithBranchInventory (el camino que usa el POS) aplana
  // `category: {name}` a `categoryName: string` — sin `category` anidado.
  const flatShaped = [
    { name: "Lija 3M #150 Metal", sku: "LJ-150", categoryName: "Ferretería" },
    { name: "Lija Truper #80 Metal", sku: "LJ-080", categoryName: "Ferretería" },
  ];
  const groups = groupProductsByFamily(flatShaped);
  assert.equal(groups[0].categoryName, "Ferretería");
});
