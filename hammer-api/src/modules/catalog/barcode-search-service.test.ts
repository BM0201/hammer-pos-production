import assert from "node:assert/strict";
import test from "node:test";
import type { ProductBarcodeKind } from "@prisma/client";
import { searchBarcodes, listAllBarcodesForExport, getBarcodeCoverage, listProductsWithoutBarcodeForCategoryWalk, countBarcodeIssues } from "@/modules/catalog/barcode-search-service";

/**
 * Fase 1.3 (prompt-codigos-editar-eliminar.md) — fake-db mínimo para los dos
 * caminos de searchBarcodes: paginado por DB (sin `issue`) y de tabla
 * completa en memoria (con `issue`, o el export CSV).
 */
type FakeProduct = { id: string; name: string; sku: string; isActive: boolean; mergedIntoProductId: string | null };
type FakeBarcode = { id: string; productId: string; code: string; kind: ProductBarcodeKind; isPrimary: boolean; createdAt: Date };

type WhereClause = {
  id?: { not?: string };
  kind?: ProductBarcodeKind;
  productId?: { in: string[] };
  isPrimary?: boolean;
  OR?: Array<{ code?: { contains: string }; product?: { name?: { contains: string }; sku?: { contains: string } } }>;
};

function buildFakeDb(products: FakeProduct[], barcodes: FakeBarcode[]) {
  function productOf(b: FakeBarcode) {
    return products.find((p) => p.id === b.productId)!;
  }
  function matches(b: FakeBarcode, where: WhereClause): boolean {
    if (where.id?.not !== undefined && b.id === where.id.not) return false;
    if (where.kind && b.kind !== where.kind) return false;
    if (where.productId?.in && !where.productId.in.includes(b.productId)) return false;
    if (where.isPrimary !== undefined && b.isPrimary !== where.isPrimary) return false;
    if (where.OR) {
      const any = where.OR.some((cond) => {
        if (cond.code?.contains) return b.code.toLowerCase().includes(cond.code.contains.toLowerCase());
        if (cond.product?.name?.contains) return productOf(b).name.toLowerCase().includes(cond.product.name.contains.toLowerCase());
        if (cond.product?.sku?.contains) return productOf(b).sku.toLowerCase().includes(cond.product.sku.contains.toLowerCase());
        return false;
      });
      if (!any) return false;
    }
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    productBarcode: {
      findUnique: async ({ where }: { where: { code: string } }) => {
        const found = barcodes.find((b) => b.code === where.code);
        return found ? { ...found, product: productOf(found) } : null;
      },
      findMany: async ({ where, take, cursor, skip, select }: { where?: WhereClause; take?: number; cursor?: { id: string }; skip?: number; select?: Record<string, boolean> }) => {
        let rows = barcodes.filter((b) => matches(b, where ?? {}));
        rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (cursor) {
          const idx = rows.findIndex((b) => b.id === cursor.id);
          rows = idx === -1 ? [] : rows.slice(idx + (skip ?? 0));
        }
        if (take !== undefined) rows = rows.slice(0, take);
        if (select) return rows.map((b) => ({ productId: b.productId }));
        return rows.map((b) => ({ ...b, product: productOf(b) }));
      },
      groupBy: async ({ where }: { where?: WhereClause }) => {
        const rows = barcodes.filter((b) => matches(b, where ?? {}));
        const counts = new Map<string, number>();
        for (const r of rows) counts.set(r.productId, (counts.get(r.productId) ?? 0) + 1);
        return [...counts.entries()].map(([productId, count]) => ({ productId, _count: { _all: count } }));
      },
    },
  };
  return db;
}

function product(overrides: Partial<FakeProduct> = {}): FakeProduct {
  return { id: "p1", name: "Producto 1", sku: "SKU-1", isActive: true, mergedIntoProductId: null, ...overrides };
}
function barcode(overrides: Partial<FakeBarcode> = {}): FakeBarcode {
  return { id: "bc1", productId: "p1", code: "4006381333931", kind: "FACTORY", isPrimary: true, createdAt: new Date(0), ...overrides };
}

test("LA QUE IMPORTA — búsqueda exacta primero: escanear un código registrado devuelve su fila directo", async () => {
  const db = buildFakeDb(
    [product({ id: "p1", name: "Cemento" }), product({ id: "p2", name: "Cementerio de cosas", sku: "SKU-CEM" })],
    [barcode({ id: "bc1", productId: "p1", code: "123" }), barcode({ id: "bc2", productId: "p2", code: "456cement789" })],
  );
  const result = await searchBarcodes({ q: "123", limit: 10 }, db);
  assert.equal(result.barcodes[0].id, "bc1", "el match exacto va primero");
});

test("sin match exacto, cae a 'contiene' por código, nombre o SKU", async () => {
  const db = buildFakeDb(
    [product({ id: "p1", name: "Pintura Latex" }), product({ id: "p2", name: "Clavo", sku: "FER-CLV" })],
    [barcode({ id: "bc1", productId: "p1", code: "111" }), barcode({ id: "bc2", productId: "p2", code: "222" })],
  );
  const result = await searchBarcodes({ q: "latex", limit: 10 }, db);
  assert.equal(result.barcodes.length, 1);
  assert.equal(result.barcodes[0].id, "bc1");
});

test("LA QUE IMPORTA — cada fila trae su producto y cuántos códigos tiene en total", async () => {
  const db = buildFakeDb(
    [product({ id: "p1" })],
    [
      barcode({ id: "bc1", productId: "p1", code: "111", isPrimary: true }),
      barcode({ id: "bc2", productId: "p1", code: "222", isPrimary: false }),
    ],
  );
  const result = await searchBarcodes({ limit: 10 }, db);
  assert.equal(result.barcodes.find((b) => b.id === "bc1")!.product.barcodeCount, 2);
});

test("paginación por cursor sin issue: nextCursor cuando hay más, null cuando no", async () => {
  const db = buildFakeDb(
    [product({ id: "p1" })],
    [
      barcode({ id: "bc1", productId: "p1", code: "111", createdAt: new Date(3) }),
      barcode({ id: "bc2", productId: "p1", code: "222", createdAt: new Date(2) }),
      barcode({ id: "bc3", productId: "p1", code: "333", createdAt: new Date(1) }),
    ],
  );
  const page1 = await searchBarcodes({ limit: 2 }, db);
  assert.equal(page1.barcodes.length, 2);
  assert.equal(page1.nextCursor, "bc2");
  const page2 = await searchBarcodes({ limit: 2, cursor: page1.nextCursor! }, db);
  assert.equal(page2.barcodes.length, 1);
  assert.equal(page2.barcodes[0].id, "bc3");
  assert.equal(page2.nextCursor, null);
});

// ── issue: CHECKSUM_INVALID ───────────────────────────────────────────────

test("LA QUE IMPORTA — issue=CHECKSUM_INVALID filtra solo los códigos con el dígito verificador roto", async () => {
  const db = buildFakeDb(
    [product({ id: "p1" })],
    [
      barcode({ id: "bc1", productId: "p1", code: "4006381333931" }), // válido
      barcode({ id: "bc2", productId: "p1", code: "4006381333930" }), // inválido
    ],
  );
  const result = await searchBarcodes({ issue: "CHECKSUM_INVALID", limit: 10 }, db);
  assert.equal(result.barcodes.length, 1);
  assert.equal(result.barcodes[0].id, "bc2");
});

// ── issue: PRODUCT_INACTIVE / PRODUCT_MERGED ──────────────────────────────

test("issue=PRODUCT_INACTIVE / PRODUCT_MERGED", async () => {
  const db = buildFakeDb(
    [product({ id: "p1", isActive: false }), product({ id: "p2", mergedIntoProductId: "p-survivor" }), product({ id: "p3" })],
    [barcode({ id: "bc1", productId: "p1", code: "111" }), barcode({ id: "bc2", productId: "p2", code: "222" }), barcode({ id: "bc3", productId: "p3", code: "333" })],
  );
  const inactive = await searchBarcodes({ issue: "PRODUCT_INACTIVE", limit: 10 }, db);
  assert.deepEqual(inactive.barcodes.map((b) => b.id), ["bc1"]);
  const merged = await searchBarcodes({ issue: "PRODUCT_MERGED", limit: 10 }, db);
  assert.deepEqual(merged.barcodes.map((b) => b.id), ["bc2"]);
});

// ── issue: MULTIPLE_CODES / NO_PRIMARY ────────────────────────────────────

test("issue=MULTIPLE_CODES: 3 o más códigos del mismo producto", async () => {
  const db = buildFakeDb(
    [product({ id: "p1" }), product({ id: "p2" })],
    [
      barcode({ id: "bc1", productId: "p1", code: "111" }),
      barcode({ id: "bc2", productId: "p1", code: "222" }),
      barcode({ id: "bc3", productId: "p1", code: "333" }),
      barcode({ id: "bc4", productId: "p2", code: "444" }),
      barcode({ id: "bc5", productId: "p2", code: "555" }),
    ],
  );
  const result = await searchBarcodes({ issue: "MULTIPLE_CODES", limit: 10 }, db);
  assert.deepEqual([...result.barcodes.map((b) => b.id)].sort(), ["bc1", "bc2", "bc3"]);
});

test("issue=NO_PRIMARY: producto con códigos pero ninguno marcado principal", async () => {
  const db = buildFakeDb(
    [product({ id: "p1" })],
    [barcode({ id: "bc1", productId: "p1", code: "111", isPrimary: false }), barcode({ id: "bc2", productId: "p1", code: "222", isPrimary: false })],
  );
  const result = await searchBarcodes({ issue: "NO_PRIMARY", limit: 10 }, db);
  assert.equal(result.barcodes.length, 2);
});

// ── issue: INTERNAL_SKU_MISMATCH ──────────────────────────────────────────

test("issue=INTERNAL_SKU_MISMATCH: un HMR- que ya no coincide con el SKU actual", async () => {
  const db = buildFakeDb(
    [product({ id: "p1", sku: "FER-0099" })],
    [barcode({ id: "bc1", productId: "p1", code: "HMR-FER-0001", kind: "INTERNAL" })],
  );
  const result = await searchBarcodes({ issue: "INTERNAL_SKU_MISMATCH", limit: 10 }, db);
  assert.deepEqual(result.barcodes.map((b) => b.id), ["bc1"]);
});

// ── paginación con issue (en memoria) ─────────────────────────────────────

test("paginación con issue: nextCursor avanza sobre el set YA filtrado, no sobre la tabla completa", async () => {
  const db = buildFakeDb(
    [product({ id: "p1" })],
    [
      barcode({ id: "bc1", productId: "p1", code: "4006381333930", createdAt: new Date(4) }), // inválido
      barcode({ id: "bc2", productId: "p1", code: "4006381333931", createdAt: new Date(3) }), // válido — no debe contar para la paginación
      barcode({ id: "bc3", productId: "p1", code: "036000291451", createdAt: new Date(2) }), // inválido
      barcode({ id: "bc4", productId: "p1", code: "036000291452", createdAt: new Date(1) }), // válido
    ],
  );
  const page1 = await searchBarcodes({ issue: "CHECKSUM_INVALID", limit: 1 }, db);
  assert.deepEqual(page1.barcodes.map((b) => b.id), ["bc1"]);
  assert.equal(page1.nextCursor, "bc1");
  const page2 = await searchBarcodes({ issue: "CHECKSUM_INVALID", limit: 1, cursor: page1.nextCursor! }, db);
  assert.deepEqual(page2.barcodes.map((b) => b.id), ["bc3"]);
  assert.equal(page2.nextCursor, null);
});

// ── export CSV ────────────────────────────────────────────────────────────

test("LA QUE IMPORTA — listAllBarcodesForExport trae TODO el set filtrado, nunca una sola página", async () => {
  const db = buildFakeDb(
    [product({ id: "p1" })],
    Array.from({ length: 5 }, (_, i) => barcode({ id: `bc${i}`, productId: "p1", code: `99900000000${i}`, createdAt: new Date(i) })),
  );
  const rows = await listAllBarcodesForExport({}, db);
  assert.equal(rows.length, 5);
});

// ── getBarcodeCoverage ─────────────────────────────────────────────────────

test("LA QUE IMPORTA — getBarcodeCoverage: cuenta productos con código vs total, por categoría", async () => {
  const productsFixture = [
    { id: "p1", isActive: true, mergedIntoProductId: null, categoryId: "cat-a", hasBarcode: true },
    { id: "p2", isActive: true, mergedIntoProductId: null, categoryId: "cat-a", hasBarcode: false },
    { id: "p3", isActive: true, mergedIntoProductId: null, categoryId: "cat-b", hasBarcode: true },
    { id: "p4", isActive: false, mergedIntoProductId: null, categoryId: "cat-a", hasBarcode: true }, // inactivo, no cuenta
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    product: {
      count: async ({ where }: { where: { isActive?: boolean; mergedIntoProductId?: null; categoryId?: string; barcodes?: { some: object } } }) =>
        productsFixture.filter((p) =>
          (where.isActive === undefined || p.isActive === where.isActive) &&
          (where.mergedIntoProductId === undefined || p.mergedIntoProductId === where.mergedIntoProductId) &&
          (where.categoryId === undefined || p.categoryId === where.categoryId) &&
          (where.barcodes === undefined || p.hasBarcode),
        ).length,
    },
  };
  const result = await getBarcodeCoverage({ categoryId: "cat-a" }, db);
  assert.deepEqual(result, { withBarcode: 1, total: 2 });
});

// ── listProductsWithoutBarcodeForCategoryWalk ─────────────────────────────

test("LA QUE IMPORTA — listProductsWithoutBarcodeForCategoryWalk: solo productos sin código, de esa categoría, con su stock en la sucursal", async () => {
  const productsFixture = [
    { id: "p1", name: "Sin código, con stock", sku: "SKU-1", categoryId: "cat-a", isActive: true, mergedIntoProductId: null, hasBarcode: false },
    { id: "p2", name: "Ya tiene código", sku: "SKU-2", categoryId: "cat-a", isActive: true, mergedIntoProductId: null, hasBarcode: true },
    { id: "p3", name: "Otra categoría", sku: "SKU-3", categoryId: "cat-b", isActive: true, mergedIntoProductId: null, hasBarcode: false },
  ];
  const balancesFixture = [{ branchId: "b1", productId: "p1", quantityOnHand: 7 }];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    product: {
      findMany: async ({ where }: { where: { categoryId: string; barcodes: { none: object } } }) =>
        productsFixture.filter((p) => p.categoryId === where.categoryId && !p.hasBarcode).map((p) => ({ id: p.id, name: p.name, sku: p.sku })),
    },
    inventoryBalance: {
      findMany: async ({ where }: { where: { branchId: string; productId: { in: string[] } } }) =>
        balancesFixture.filter((b) => b.branchId === where.branchId && where.productId.in.includes(b.productId)),
    },
  };
  const result = await listProductsWithoutBarcodeForCategoryWalk({ categoryId: "cat-a", branchId: "b1" }, db);
  assert.equal(result.length, 1);
  assert.equal(result[0].productId, "p1");
  assert.equal(result[0].stockInBranch, 7);
});

// ── countBarcodeIssues ─────────────────────────────────────────────────────

test("LA QUE IMPORTA — countBarcodeIssues: el total real por issue, no solo una página", async () => {
  const db = buildFakeDb(
    [product({ id: "p1", isActive: false }), product({ id: "p2" })],
    [
      barcode({ id: "bc1", productId: "p1", code: "111" }),
      barcode({ id: "bc2", productId: "p2", code: "4006381333930" }), // checksum inválido
    ],
  );
  const counts = await countBarcodeIssues(db);
  assert.equal(counts.PRODUCT_INACTIVE, 1);
  assert.equal(counts.CHECKSUM_INVALID, 1);
  assert.equal(counts.MULTIPLE_CODES, 0);
});
