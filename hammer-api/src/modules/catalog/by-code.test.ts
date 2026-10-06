import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { findProductByCode, assignInternalBarcode } from "@/modules/catalog/service";

/**
 * prompt-alta-productos-qr.md Fase 1 — findProductByCode: coincidencia
 * EXACTA, barcode primero, sku después, nunca difusa. assignInternalBarcode:
 * solo asigna si el producto no tiene barcode todavía.
 */

function createCatalogFakeDb(products: Array<{ id: string; sku: string; barcode: string | null; name: string }>) {
  const fullProduct = (p: typeof products[number]) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    unit: "UNIDAD",
    standardSalePrice: new Prisma.Decimal(100),
    isActive: true,
    category: { id: "cat-1", code: "GEN", name: "General" },
  });

  const db = {
    product: {
      findUnique: async ({ where }: { where: { barcode?: string; sku?: string } }) => {
        if (where.barcode !== undefined) {
          const found = products.find((p) => p.barcode === where.barcode);
          return found ? fullProduct(found) : null;
        }
        if (where.sku !== undefined) {
          const found = products.find((p) => p.sku === where.sku);
          return found ? fullProduct(found) : null;
        }
        return null;
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const found = products.find((p) => p.id === where.id);
        if (!found) throw new Error("not found");
        return { id: found.id, sku: found.sku, barcode: found.barcode };
      },
      update: async ({ where, data }: { where: { id: string }; data: { barcode: string } }) => {
        const found = products.find((p) => p.id === where.id);
        if (!found) throw new Error("not found");
        found.barcode = data.barcode;
        return { id: found.id, name: found.name, sku: found.sku, barcode: found.barcode };
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return db as Prisma.TransactionClient | typeof import("@/lib/prisma").prisma;
}

test("findProductByCode — coincidencia por barcode", async () => {
  const db = createCatalogFakeDb([{ id: "p1", sku: "MAD-0001", barcode: "7501234567890", name: "Cemento" }]);
  const result = await findProductByCode("7501234567890", db);
  assert.equal(result.matchedBy, "barcode");
  assert.equal(result.product?.id, "p1");
});

test("findProductByCode — sin barcode, coincide por sku", async () => {
  const db = createCatalogFakeDb([{ id: "p2", sku: "FER-0042", barcode: null, name: "Clavo 2 pulgadas" }]);
  const result = await findProductByCode("FER-0042", db);
  assert.equal(result.matchedBy, "sku");
  assert.equal(result.product?.id, "p2");
});

test("findProductByCode — sin coincidencia: product null, matchedBy null", async () => {
  const db = createCatalogFakeDb([{ id: "p3", sku: "MAD-0002", barcode: "123", name: "Tabla" }]);
  const result = await findProductByCode("no-existe", db);
  assert.equal(result.matchedBy, null);
  assert.equal(result.product, null);
});

test("findProductByCode — normaliza antes de comparar (espacios)", async () => {
  const db = createCatalogFakeDb([{ id: "p4", sku: "MAD-0003", barcode: "7501234567890", name: "Pintura" }]);
  const result = await findProductByCode("  7501234567890  ", db);
  assert.equal(result.matchedBy, "barcode");
});

test("assignInternalBarcode — producto que YA tiene barcode: rechaza sin tocarlo (sale antes de auditar/escribir)", async () => {
  const db = createCatalogFakeDb([{ id: "p5", sku: "FER-0099", barcode: "7501111111111", name: "Tornillo" }]);
  await assert.rejects(
    () => assignInternalBarcode("p5", "user-1", db),
    /BARCODE_ALREADY_SET/,
  );
});

// El camino feliz (producto SIN barcode -> se le asigna HMR-<sku>) también
// llama a logAuditEvent, que usa el prisma GLOBAL (no el `db` inyectado) —
// no se prueba acá para no pegarle a la base real; buildInternalBarcode ya
// cubre la lógica del código en barcode.test.ts.
