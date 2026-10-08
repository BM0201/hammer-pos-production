import assert from "node:assert/strict";
import test from "node:test";
import {
  addBarcode,
  setPrimaryBarcode,
  removeBarcode,
  moveBarcode,
  replacePrimaryBarcode,
  classifyBackfillBarcode,
} from "@/modules/catalog/product-barcode-service";
import { BarcodeAlreadyExistsError } from "@/modules/catalog/barcode-errors";

/**
 * prompt-codigos-y-duplicados.md Fase 1 — varios códigos por producto:
 * agregar, quitar, mover y marcar principal, con auditoría.
 */

type FakeProduct = { id: string; sku: string; barcode: string | null; name: string; isActive?: boolean };
type FakeBarcode = { id: string; productId: string; code: string; kind: string; isPrimary: boolean; createdAt: Date; createdByUserId: string | null };

function createFakeDb(products: FakeProduct[], barcodes: FakeBarcode[] = []) {
  const auditLogs: Array<Record<string, unknown>> = [];
  let nextId = 1;

  const db = {
    product: {
      update: async ({ where, data }: { where: { id: string }; data: { barcode?: string | null } }) => {
        const found = products.find((p) => p.id === where.id);
        if (!found) throw new Error("not found");
        if (data.barcode !== undefined) found.barcode = data.barcode;
        return { ...found };
      },
    },
    productBarcode: {
      findUnique: async ({ where }: { where: { code?: string; id?: string } }) => {
        const found = where.code !== undefined
          ? barcodes.find((b) => b.code === where.code)
          : barcodes.find((b) => b.id === where.id);
        if (!found) return null;
        const product = products.find((p) => p.id === found.productId);
        return { ...found, product: product ? { id: product.id, name: product.name, sku: product.sku, isActive: product.isActive ?? true } : null };
      },
      findFirst: async ({ where, orderBy }: { where: { productId: string; isPrimary?: boolean }; orderBy?: { createdAt: "asc" | "desc" } }) => {
        let matches = barcodes.filter(
          (b) => b.productId === where.productId && (where.isPrimary === undefined || b.isPrimary === where.isPrimary),
        );
        if (orderBy?.createdAt === "asc") matches = [...matches].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return matches[0] ? { ...matches[0] } : null;
      },
      create: async ({ data }: { data: Omit<FakeBarcode, "id" | "createdAt"> & { createdAt?: Date } }) => {
        const row: FakeBarcode = { id: `bc${nextId++}`, createdAt: data.createdAt ?? new Date(Date.now() + nextId), ...data };
        barcodes.push(row);
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeBarcode> }) => {
        const found = barcodes.find((b) => b.id === where.id);
        if (!found) throw new Error("not found");
        Object.assign(found, data);
        return { ...found };
      },
      updateMany: async ({ where, data }: { where: { id?: string; productId?: string; isPrimary?: boolean }; data: Partial<FakeBarcode> }) => {
        const matches = barcodes.filter(
          (b) =>
            (where.id === undefined || b.id === where.id) &&
            (where.productId === undefined || b.productId === where.productId) &&
            (where.isPrimary === undefined || b.isPrimary === where.isPrimary),
        );
        for (const m of matches) Object.assign(m, data);
        return { count: matches.length };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const idx = barcodes.findIndex((b) => b.id === where.id);
        if (idx === -1) throw new Error("not found");
        const [removed] = barcodes.splice(idx, 1);
        return { ...removed };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return data;
      },
    },
    $queryRaw: async () => [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { db, auditLogs, barcodes, products };
}

test("classifyBackfillBarcode — HMR- es INTERNAL, cualquier otro es FACTORY (misma regla que la migración)", () => {
  assert.equal(classifyBackfillBarcode("HMR-FER-0001").kind, "INTERNAL");
  assert.equal(classifyBackfillBarcode("7501234567890").kind, "FACTORY");
});

test("addBarcode — primer código de un producto: queda PRINCIPAL y se refleja en Product.barcode", async () => {
  const { db, barcodes, products } = createFakeDb([{ id: "p1", sku: "A-1", barcode: null, name: "Producto 1" }]);
  const created = await addBarcode({ productId: "p1", rawCode: "123", kind: "FACTORY", actorUserId: "u1" }, db);
  assert.equal(created.isPrimary, true);
  assert.equal(barcodes.length, 1);
  assert.equal(products[0].barcode, "123");
});

test("addBarcode — segundo código del MISMO producto: NO es principal, Product.barcode no cambia", async () => {
  const { db, barcodes, products } = createFakeDb(
    [{ id: "p1", sku: "A-1", barcode: "123", name: "Producto 1" }],
    [{ id: "bc1", productId: "p1", code: "123", kind: "FACTORY", isPrimary: true, createdAt: new Date(0), createdByUserId: null }],
  );
  const created = await addBarcode({ productId: "p1", rawCode: "456", kind: "SUPPLIER", actorUserId: "u1" }, db);
  assert.equal(created.isPrimary, false);
  assert.equal(barcodes.length, 2);
  assert.equal(products[0].barcode, "123");
});

test("addBarcode — código que ya es de OTRO producto: 409 BarcodeAlreadyExistsError con el producto dueño", async () => {
  const { db } = createFakeDb(
    [
      { id: "p1", sku: "A-1", barcode: "123", name: "Producto 1" },
      { id: "p2", sku: "A-2", barcode: null, name: "Producto 2" },
    ],
    [{ id: "bc1", productId: "p1", code: "123", kind: "FACTORY", isPrimary: true, createdAt: new Date(0), createdByUserId: null }],
  );
  await assert.rejects(
    () => addBarcode({ productId: "p2", rawCode: "123", kind: "FACTORY", actorUserId: "u1" }, db),
    (err: unknown) => {
      assert.ok(err instanceof BarcodeAlreadyExistsError);
      assert.equal(err.existingProduct.id, "p1");
      return true;
    },
  );
});

test("addBarcode — el MISMO producto intenta agregar un código que ya tiene: VALIDATION_ERROR", async () => {
  const { db } = createFakeDb(
    [{ id: "p1", sku: "A-1", barcode: "123", name: "Producto 1" }],
    [{ id: "bc1", productId: "p1", code: "123", kind: "FACTORY", isPrimary: true, createdAt: new Date(0), createdByUserId: null }],
  );
  await assert.rejects(() => addBarcode({ productId: "p1", rawCode: "123", kind: "FACTORY", actorUserId: "u1" }, db), /VALIDATION_ERROR/);
});

test("addBarcode — código vacío tras normalizar: VALIDATION_ERROR", async () => {
  const { db } = createFakeDb([{ id: "p1", sku: "A-1", barcode: null, name: "Producto 1" }]);
  await assert.rejects(() => addBarcode({ productId: "p1", rawCode: "   ", kind: "FACTORY", actorUserId: "u1" }, db), /VALIDATION_ERROR/);
});

test("removeBarcode — quitar un código SECUNDARIO no toca el principal ni Product.barcode", async () => {
  const { db, barcodes, products } = createFakeDb(
    [{ id: "p1", sku: "A-1", barcode: "123", name: "Producto 1" }],
    [
      { id: "bc1", productId: "p1", code: "123", kind: "FACTORY", isPrimary: true, createdAt: new Date(0), createdByUserId: null },
      { id: "bc2", productId: "p1", code: "456", kind: "SUPPLIER", isPrimary: false, createdAt: new Date(1), createdByUserId: null },
    ],
  );
  const result = await removeBarcode("bc2", "u1", db);
  assert.equal(result.newPrimaryCode, null);
  assert.equal(barcodes.length, 1);
  assert.equal(products[0].barcode, "123");
});

test("removeBarcode — quitar el PRINCIPAL promueve al siguiente más viejo", async () => {
  const { db, barcodes, products } = createFakeDb(
    [{ id: "p1", sku: "A-1", barcode: "123", name: "Producto 1" }],
    [
      { id: "bc1", productId: "p1", code: "123", kind: "FACTORY", isPrimary: true, createdAt: new Date(0), createdByUserId: null },
      { id: "bc2", productId: "p1", code: "456", kind: "SUPPLIER", isPrimary: false, createdAt: new Date(1), createdByUserId: null },
    ],
  );
  const result = await removeBarcode("bc1", "u1", db);
  assert.equal(result.newPrimaryCode, "456");
  assert.equal(barcodes.find((b) => b.id === "bc2")?.isPrimary, true);
  assert.equal(products[0].barcode, "456");
});

test("removeBarcode — quitar el PRINCIPAL sin ningún otro código: Product.barcode queda null", async () => {
  const { db, products } = createFakeDb(
    [{ id: "p1", sku: "A-1", barcode: "123", name: "Producto 1" }],
    [{ id: "bc1", productId: "p1", code: "123", kind: "FACTORY", isPrimary: true, createdAt: new Date(0), createdByUserId: null }],
  );
  const result = await removeBarcode("bc1", "u1", db);
  assert.equal(result.newPrimaryCode, null);
  assert.equal(products[0].barcode, null);
});

test("setPrimaryBarcode — promueve un secundario y refleja Product.barcode", async () => {
  const { db, barcodes, products } = createFakeDb(
    [{ id: "p1", sku: "A-1", barcode: "123", name: "Producto 1" }],
    [
      { id: "bc1", productId: "p1", code: "123", kind: "FACTORY", isPrimary: true, createdAt: new Date(0), createdByUserId: null },
      { id: "bc2", productId: "p1", code: "456", kind: "SUPPLIER", isPrimary: false, createdAt: new Date(1), createdByUserId: null },
    ],
  );
  await setPrimaryBarcode("p1", "bc2", "u1", db);
  assert.equal(barcodes.find((b) => b.id === "bc1")?.isPrimary, false);
  assert.equal(barcodes.find((b) => b.id === "bc2")?.isPrimary, true);
  assert.equal(products[0].barcode, "456");
});

test("moveBarcode — mueve el código al producto destino, re-promueve el origen", async () => {
  const { db, barcodes, products } = createFakeDb(
    [
      { id: "p1", sku: "A-1", barcode: "123", name: "Producto 1" },
      { id: "p2", sku: "A-2", barcode: null, name: "Producto 2" },
    ],
    [
      { id: "bc1", productId: "p1", code: "123", kind: "FACTORY", isPrimary: true, createdAt: new Date(0), createdByUserId: null },
      { id: "bc2", productId: "p1", code: "456", kind: "SUPPLIER", isPrimary: false, createdAt: new Date(1), createdByUserId: null },
    ],
  );
  const result = await moveBarcode("bc1", "p2", "u1", db);
  assert.equal(result.code, "123");
  assert.equal(barcodes.find((b) => b.id === "bc1")?.productId, "p2");
  // p1 se queda sin principal propio: bc2 (el único que le queda) lo reemplaza.
  assert.equal(products[0].barcode, "456");
  // p2 no tenía ningún código: el recién llegado pasa a ser su principal.
  assert.equal(products[1].barcode, "123");
});

test("moveBarcode — doble intento al MISMO destino: el segundo da ALREADY_PROCESSED", async () => {
  const { db } = createFakeDb(
    [
      { id: "p1", sku: "A-1", barcode: "123", name: "Producto 1" },
      { id: "p2", sku: "A-2", barcode: null, name: "Producto 2" },
    ],
    [{ id: "bc1", productId: "p1", code: "123", kind: "FACTORY", isPrimary: true, createdAt: new Date(0), createdByUserId: null }],
  );
  await moveBarcode("bc1", "p2", "u1", db);
  await assert.rejects(() => moveBarcode("bc1", "p2", "u1", db), /ALREADY_PROCESSED/);
});

test("replacePrimaryBarcode — producto sin código: crea uno nuevo como principal", async () => {
  const { db, barcodes, products } = createFakeDb([{ id: "p1", sku: "A-1", barcode: null, name: "Producto 1" }]);
  const result = await replacePrimaryBarcode("p1", "999", "u1", db);
  assert.equal(result.code, "999");
  assert.equal(barcodes.length, 1);
  assert.equal(products[0].barcode, "999");
});

test("replacePrimaryBarcode — mismo código que ya tenía: no-op", async () => {
  const { db, barcodes } = createFakeDb(
    [{ id: "p1", sku: "A-1", barcode: "123", name: "Producto 1" }],
    [{ id: "bc1", productId: "p1", code: "123", kind: "FACTORY", isPrimary: true, createdAt: new Date(0), createdByUserId: null }],
  );
  const result = await replacePrimaryBarcode("p1", "123", "u1", db);
  assert.equal(result.code, "123");
  assert.equal(barcodes.length, 1);
});

test("replacePrimaryBarcode — código nuevo reemplaza al principal viejo (se queda como uno solo)", async () => {
  const { db, barcodes, products } = createFakeDb(
    [{ id: "p1", sku: "A-1", barcode: "123", name: "Producto 1" }],
    [{ id: "bc1", productId: "p1", code: "123", kind: "FACTORY", isPrimary: true, createdAt: new Date(0), createdByUserId: null }],
  );
  const result = await replacePrimaryBarcode("p1", "999", "u1", db);
  assert.equal(result.code, "999");
  assert.equal(barcodes.length, 1);
  assert.equal(barcodes[0].code, "999");
  assert.equal(barcodes[0].isPrimary, true);
  assert.equal(products[0].barcode, "999");
});

test("replacePrimaryBarcode — null/vacío quita el principal sin poner uno nuevo", async () => {
  const { db, barcodes, products } = createFakeDb(
    [{ id: "p1", sku: "A-1", barcode: "123", name: "Producto 1" }],
    [{ id: "bc1", productId: "p1", code: "123", kind: "FACTORY", isPrimary: true, createdAt: new Date(0), createdByUserId: null }],
  );
  const result = await replacePrimaryBarcode("p1", null, "u1", db);
  assert.equal(result.code, null);
  assert.equal(barcodes.length, 0);
  assert.equal(products[0].barcode, null);
});

test("replacePrimaryBarcode — código ya usado por OTRO producto: BarcodeAlreadyExistsError, no toca nada", async () => {
  const { db, barcodes } = createFakeDb(
    [
      { id: "p1", sku: "A-1", barcode: "123", name: "Producto 1" },
      { id: "p2", sku: "A-2", barcode: "999", name: "Producto 2" },
    ],
    [
      { id: "bc1", productId: "p1", code: "123", kind: "FACTORY", isPrimary: true, createdAt: new Date(0), createdByUserId: null },
      { id: "bc2", productId: "p2", code: "999", kind: "FACTORY", isPrimary: true, createdAt: new Date(0), createdByUserId: null },
    ],
  );
  await assert.rejects(() => replacePrimaryBarcode("p1", "999", "u1", db), (err: unknown) => err instanceof BarcodeAlreadyExistsError);
  assert.equal(barcodes.length, 2);
  assert.equal(barcodes.find((b) => b.id === "bc1")?.code, "123");
});
