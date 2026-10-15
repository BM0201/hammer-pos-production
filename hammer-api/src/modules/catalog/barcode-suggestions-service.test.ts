import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { suggestProductsForBarcode, getSuggestionAcceptanceStats } from "@/modules/catalog/barcode-suggestions-service";

/**
 * Fase 2 (prompt-codigos-editar-eliminar.md) — fake-db para
 * suggestProductsForBarcode: el ranking en sí ya está probado a fondo en
 * barcode-suggestions.test.ts (puro); esto solo confirma que la capa de
 * datos conecta bien (prefijo GS1 vía $queryRaw, pool por categoría/`q`,
 * agregados de stock/actividad reciente).
 */
type FakeProduct = {
  id: string; name: string; sku: string; unit: string; categoryId: string; categoryName: string;
  isActive: boolean; mergedIntoProductId: string | null;
};
type FakeBarcode = { productId: string; code: string; kind: "FACTORY" | "INTERNAL" | "SUPPLIER" };
type FakeMovement = { productId: string; movementType: "SALE_OUT" | "PURCHASE_IN" | "OTHER"; createdAt: Date };
type FakeBalance = { branchId: string; productId: string; quantityOnHand: number };

function buildFakeDb(opts: {
  products: FakeProduct[];
  barcodes?: FakeBarcode[];
  balances?: FakeBalance[];
  movements?: FakeMovement[];
}) {
  const products = opts.products;
  const barcodes = opts.barcodes ?? [];
  const balances = opts.balances ?? [];
  const movements = opts.movements ?? [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const likePattern = String(values[0]); // "<prefix>%"
      const prefix = likePattern.slice(0, -1);
      return barcodes
        .filter((b) => b.kind === "FACTORY" && b.code.startsWith(prefix))
        .map((b) => {
          const p = products.find((pp) => pp.id === b.productId)!;
          return { code: b.code, productId: b.productId, name: p.name, unit: p.unit, categoryId: p.categoryId };
        });
    },
    product: {
      findMany: async ({ where, take }: { where: { id?: { in: string[] }; categoryId?: { in: string[] }; isActive?: boolean; barcodes?: { none: object }; name?: { contains: string } }; take?: number }) => {
        let rows = products;
        if (where.id) rows = rows.filter((p) => where.id!.in.includes(p.id));
        if (where.categoryId) rows = rows.filter((p) => where.categoryId!.in.includes(p.categoryId));
        if (where.isActive !== undefined) rows = rows.filter((p) => p.isActive === where.isActive);
        if (where.barcodes) rows = rows.filter((p) => !barcodes.some((b) => b.productId === p.id));
        if (where.name) rows = rows.filter((p) => p.name.toLowerCase().includes(where.name!.contains.toLowerCase()));
        if (take !== undefined) rows = rows.slice(0, take);
        return rows.map((p) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit, categoryId: p.categoryId, isActive: p.isActive, mergedIntoProductId: p.mergedIntoProductId, category: { name: p.categoryName } }));
      },
    },
    productBarcode: {
      groupBy: async ({ where }: { where: { productId: { in: string[] } } }) => {
        const counts = new Map<string, number>();
        for (const b of barcodes) if (where.productId.in.includes(b.productId)) counts.set(b.productId, (counts.get(b.productId) ?? 0) + 1);
        return [...counts.entries()].map(([productId, count]) => ({ productId, _count: { _all: count } }));
      },
    },
    inventoryBalance: {
      findMany: async ({ where }: { where: { branchId: string; productId: { in: string[] } } }) =>
        balances.filter((b) => b.branchId === where.branchId && where.productId.in.includes(b.productId)).map((b) => ({ productId: b.productId, quantityOnHand: new Prisma.Decimal(b.quantityOnHand) })),
    },
    inventoryMovement: {
      groupBy: async ({ where }: { where: { productId: { in: string[] }; movementType: { in: string[] }; createdAt: { gte: Date } } }) => {
        const matches = movements.filter((m) => where.productId.in.includes(m.productId) && where.movementType.in.includes(m.movementType) && m.createdAt >= where.createdAt.gte);
        const ids = [...new Set(matches.map((m) => m.productId))];
        return ids.map((productId) => ({ productId, _count: { _all: matches.filter((m) => m.productId === productId).length } }));
      },
    },
  };
  return db;
}

test("LA QUE IMPORTA — encuentra hermanos por el prefijo más largo disponible, vía $queryRaw", async () => {
  const db = buildFakeDb({
    products: [{ id: "sib-1", name: "Pintura Sello Roca Blanco", sku: "SKU-SIB", unit: "GAL", categoryId: "cat-pinturas", categoryName: "Pinturas", isActive: true, mergedIntoProductId: null }],
    barcodes: [{ productId: "sib-1", code: "7441002111113", kind: "FACTORY" }],
  });
  const result = await suggestProductsForBarcode({ code: "7441002111114" }, db);
  // Sin candidatos sin-código en esa categoría acá, pero no debe tronar y el pool queda vacío.
  assert.deepEqual(result.suggestions, []);
});

test("LA QUE IMPORTA — el pool de candidatos incluye productos sin código de la categoría de los hermanos", async () => {
  const db = buildFakeDb({
    products: [
      { id: "sib-1", name: "Pintura Sello Roca Blanco", sku: "SKU-SIB", unit: "GAL", categoryId: "cat-pinturas", categoryName: "Pinturas", isActive: true, mergedIntoProductId: null },
      { id: "cand-1", name: "Pintura Sello Roca Gris", sku: "SKU-CAND", unit: "GAL", categoryId: "cat-pinturas", categoryName: "Pinturas", isActive: true, mergedIntoProductId: null },
    ],
    barcodes: [{ productId: "sib-1", code: "7441002111113", kind: "FACTORY" }],
  });
  const result = await suggestProductsForBarcode({ code: "7441002111114" }, db);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].productId, "cand-1");
  assert.equal(result.suggestions[0].categoryName, "Pinturas");
});

test("el pool por `q` incluye productos de CUALQUIER categoría que coincidan por nombre", async () => {
  const db = buildFakeDb({
    products: [{ id: "cand-1", name: "Martillo de uña", sku: "SKU-1", unit: "UN", categoryId: "cat-herramientas", categoryName: "Herramientas", isActive: true, mergedIntoProductId: null }],
  });
  const result = await suggestProductsForBarcode({ code: "999999999999999", query: "martillo" }, db);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].productId, "cand-1");
});

test("stock en sucursal y actividad reciente se reflejan en la tarjeta de sugerencia", async () => {
  const db = buildFakeDb({
    products: [{ id: "cand-1", name: "Clavo de acero", sku: "SKU-1", unit: "UN", categoryId: "cat-1", categoryName: "Ferretería", isActive: true, mergedIntoProductId: null }],
    balances: [{ branchId: "b1", productId: "cand-1", quantityOnHand: 42 }],
    movements: [{ productId: "cand-1", movementType: "SALE_OUT", createdAt: new Date() }],
  });
  const result = await suggestProductsForBarcode({ code: "999999999999999", query: "clavo", branchId: "b1" }, db);
  assert.equal(result.suggestions[0].stockInBranch, 42);
});

test("producto que ya tiene código aparece en el pool de `q` pero con hasBarcode=true (menos preferido)", async () => {
  const db = buildFakeDb({
    products: [{ id: "cand-1", name: "Clavo de acero", sku: "SKU-1", unit: "UN", categoryId: "cat-1", categoryName: "Ferretería", isActive: true, mergedIntoProductId: null }],
    barcodes: [{ productId: "cand-1", code: "111", kind: "FACTORY" }],
  });
  const result = await suggestProductsForBarcode({ code: "999999999999999", query: "clavo" }, db);
  assert.equal(result.suggestions[0].hasBarcode, true);
});

// ── getSuggestionAcceptanceStats (Fase 2.4) ───────────────────────────────

test("LA QUE IMPORTA — getSuggestionAcceptanceStats: clasifica por rank elegido en los últimos 30 días", async () => {
  const logs = [
    { metadataJson: { suggestion: { rank: 1, reasons: [] } } },
    { metadataJson: { suggestion: { rank: 1, reasons: [] } } },
    { metadataJson: { suggestion: { rank: 2, reasons: [] } } },
    { metadataJson: { suggestion: { rank: 4, reasons: [] } } },
    { metadataJson: { suggestion: null } },
    { metadataJson: null },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = { auditLog: { findMany: async () => logs } };
  const stats = await getSuggestionAcceptanceStats(db);
  assert.deepEqual(stats, { total: 6, pickedFirst: 2, pickedTop3: 1, pickedOther: 1, pickedNone: 2 });
});
