import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { findProductByCode, assignInternalBarcode } from "@/modules/catalog/service";

/**
 * prompt-alta-productos-qr.md Fase 1 — findProductByCode: coincidencia
 * EXACTA, barcode primero, sku después, nunca difusa. assignInternalBarcode:
 * solo asigna si el producto no tiene barcode todavía.
 *
 * prompt-codigos-y-duplicados.md Fase 1 — findProductByCode ahora busca
 * PRIMERO en ProductBarcode (principal o secundario), no en Product.barcode
 * directo; assignInternalBarcode delega en addBarcode (product-barcode-
 * service.ts), que audita adentro del `db` inyectado — ya no hace falta
 * saltarse el camino feliz por depender del prisma global.
 */

type FakeProduct = { id: string; sku: string; barcode: string | null; name: string; isActive?: boolean };
type FakeBarcode = { id: string; productId: string; code: string; kind: string; isPrimary: boolean; createdByUserId: string | null };

function createCatalogFakeDb(products: FakeProduct[], barcodes: FakeBarcode[] = []) {
  const auditLogs: Array<Record<string, unknown>> = [];
  let nextId = 1;

  function fullProduct(p: FakeProduct) {
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      unit: "UNIDAD",
      standardSalePrice: new Prisma.Decimal(100),
      isActive: p.isActive ?? true,
      category: { id: "cat-1", code: "GEN", name: "General" },
    };
  }

  const db = {
    product: {
      findUnique: async ({ where }: { where: { id?: string; barcode?: string; sku?: string } }) => {
        let found: FakeProduct | undefined;
        if (where.id !== undefined) found = products.find((p) => p.id === where.id);
        else if (where.barcode !== undefined) found = products.find((p) => p.barcode === where.barcode);
        else if (where.sku !== undefined) found = products.find((p) => p.sku === where.sku);
        return found ? fullProduct(found) : null;
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const found = products.find((p) => p.id === where.id);
        if (!found) throw new Error("not found");
        return { id: found.id, name: found.name, sku: found.sku, barcode: found.barcode };
      },
      update: async ({ where, data }: { where: { id: string }; data: { barcode?: string | null } }) => {
        const found = products.find((p) => p.id === where.id);
        if (!found) throw new Error("not found");
        if (data.barcode !== undefined) found.barcode = data.barcode;
        return { id: found.id, name: found.name, sku: found.sku, barcode: found.barcode };
      },
    },
    productBarcode: {
      findUnique: async ({ where }: { where: { code: string } }) => {
        const found = barcodes.find((b) => b.code === where.code);
        if (!found) return null;
        const product = products.find((p) => p.id === found.productId);
        return {
          productId: found.productId,
          product: product ? { id: product.id, name: product.name, sku: product.sku, isActive: product.isActive ?? true } : null,
        };
      },
      findFirst: async ({ where }: { where: { productId: string; isPrimary?: boolean } }) => {
        const found = barcodes.find(
          (b) => b.productId === where.productId && (where.isPrimary === undefined || b.isPrimary === where.isPrimary),
        );
        return found ? { ...found } : null;
      },
      create: async ({ data }: { data: Omit<FakeBarcode, "id"> }) => {
        const row: FakeBarcode = { id: `bc${nextId++}`, ...data };
        barcodes.push(row);
        return { ...row };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return data;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { db: db as Prisma.TransactionClient | typeof import("@/lib/prisma").prisma, auditLogs, barcodes, products };
}

test("findProductByCode — coincidencia por barcode (vía ProductBarcode, código principal)", async () => {
  const { db } = createCatalogFakeDb(
    [{ id: "p1", sku: "MAD-0001", barcode: "7501234567890", name: "Cemento" }],
    [{ id: "bc1", productId: "p1", code: "7501234567890", kind: "FACTORY", isPrimary: true, createdByUserId: null }],
  );
  const result = await findProductByCode("7501234567890", db);
  assert.equal(result.matchedBy, "barcode");
  assert.equal(result.product?.id, "p1");
});

test("findProductByCode — sin barcode, coincide por sku", async () => {
  const { db } = createCatalogFakeDb([{ id: "p2", sku: "FER-0042", barcode: null, name: "Clavo 2 pulgadas" }]);
  const result = await findProductByCode("FER-0042", db);
  assert.equal(result.matchedBy, "sku");
  assert.equal(result.product?.id, "p2");
});

test("findProductByCode — sin coincidencia: product null, matchedBy null", async () => {
  const { db } = createCatalogFakeDb(
    [{ id: "p3", sku: "MAD-0002", barcode: "123", name: "Tabla" }],
    [{ id: "bc3", productId: "p3", code: "123", kind: "FACTORY", isPrimary: true, createdByUserId: null }],
  );
  const result = await findProductByCode("no-existe", db);
  assert.equal(result.matchedBy, null);
  assert.equal(result.product, null);
});

test("findProductByCode — normaliza antes de comparar (espacios)", async () => {
  const { db } = createCatalogFakeDb(
    [{ id: "p4", sku: "MAD-0003", barcode: "7501234567890", name: "Pintura" }],
    [{ id: "bc4", productId: "p4", code: "7501234567890", kind: "FACTORY", isPrimary: true, createdByUserId: null }],
  );
  const result = await findProductByCode("  7501234567890  ", db);
  assert.equal(result.matchedBy, "barcode");
});

test("findProductByCode — coincide por un código SECUNDARIO (no principal)", async () => {
  const { db } = createCatalogFakeDb(
    [{ id: "p6", sku: "FER-0100", barcode: "1000000000000", name: "Tornillo caja" }],
    [
      { id: "bc6a", productId: "p6", code: "1000000000000", kind: "FACTORY", isPrimary: true, createdByUserId: null },
      { id: "bc6b", productId: "p6", code: "2000000000000", kind: "SUPPLIER", isPrimary: false, createdByUserId: "user-1" },
    ],
  );
  const result = await findProductByCode("2000000000000", db);
  assert.equal(result.matchedBy, "barcode");
  assert.equal(result.product?.id, "p6");
});

test("assignInternalBarcode — producto que YA tiene barcode: rechaza sin tocarlo (sale antes de auditar/escribir)", async () => {
  const { db, barcodes, auditLogs } = createCatalogFakeDb([{ id: "p5", sku: "FER-0099", barcode: "7501111111111", name: "Tornillo" }]);
  await assert.rejects(
    () => assignInternalBarcode("p5", "user-1", db),
    /BARCODE_ALREADY_SET/,
  );
  assert.equal(barcodes.length, 0);
  assert.equal(auditLogs.length, 0);
});

test("assignInternalBarcode — camino feliz: crea el ProductBarcode interno (principal), refleja Product.barcode y audita", async () => {
  const { db, barcodes, auditLogs, products } = createCatalogFakeDb([{ id: "p7", sku: "FER-0200", barcode: null, name: "Martillo" }]);
  const result = await assignInternalBarcode("p7", "user-1", db);

  assert.equal(result.barcode, `HMR-FER-0200`);
  assert.equal(products[0].barcode, result.barcode);
  assert.equal(barcodes.length, 1);
  assert.equal(barcodes[0].kind, "INTERNAL");
  assert.equal(barcodes[0].isPrimary, true);
  assert.equal(barcodes[0].createdByUserId, "user-1");
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, "PRODUCT_BARCODE_ADDED");
});
