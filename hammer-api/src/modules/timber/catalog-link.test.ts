import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type TimberTripLine } from "@prisma/client";
import { parseWoodDimensions } from "@/modules/catalog/sku-generator";
import {
  assignTripCodeTx,
  nextTripCodeFrom,
  pickCatalogWoodProduct,
  resolveTimberProductIdentityTx,
  timberCatalogName,
  timberProductSearchWhere,
  tripCodePrefix,
} from "@/modules/timber/service";
import { DEFAULT_CUBICATION_TABLE } from "@/modules/timber/calculator";

/** Numeración: el correlativo solo lo consume un viaje ingresado. */

function createTripsFakeTx(initial: Array<{ id: string; tripCode: string; status: string }>) {
  const trips = initial.map((trip) => ({ ...trip }));
  const calls: string[] = [];
  const tx = {
    $executeRaw: async () => { calls.push("lock"); return 0; },
    timberTrip: {
      findMany: async (args: { where: { tripCode: { startsWith: string }; status: { in: string[] } } }) =>
        trips.filter((t) => t.tripCode.startsWith(args.where.tripCode.startsWith) && args.where.status.in.includes(t.status)),
      findUnique: async (args: { where: { tripCode: string } }) => trips.find((t) => t.tripCode === args.where.tripCode) ?? null,
      update: async (args: { where: { id: string }; data: { tripCode: string } }) => {
        calls.push("update");
        const trip = trips.find((t) => t.id === args.where.id)!;
        trip.tripCode = args.data.tripCode;
        return trip;
      },
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, trips, calls };
}

const PREFIX = tripCodePrefix();

test("numeración: crear y cancelar no corre el número — el primer viaje ingresado sale 001", async () => {
  const { tx, trips } = createTripsFakeTx([
    { id: "cancelado", tripCode: "BOR-AAAA", status: "CANCELLED" },
    { id: "nuevo", tripCode: "BOR-BBBB", status: "DRAFT" },
  ]);
  assert.equal(await assignTripCodeTx(tx, "nuevo"), `${PREFIX}001`);
  assert.equal(trips.find((t) => t.id === "cancelado")!.tripCode, "BOR-AAAA");
});

test("numeración: viajes viejos numerados al crear — el cancelado cede su número y no choca con el único", async () => {
  // El caso real de la base: VJM-…-001 y 002 cancelados, ninguno ingresado.
  const { tx, trips, calls } = createTripsFakeTx([
    { id: "viejo-1", tripCode: `${PREFIX}001`, status: "CANCELLED" },
    { id: "viejo-2", tripCode: `${PREFIX}002`, status: "CANCELLED" },
    { id: "nuevo", tripCode: "BOR-BBBB", status: "DRAFT" },
  ]);
  assert.equal(await assignTripCodeTx(tx, "nuevo"), `${PREFIX}001`);
  assert.match(trips.find((t) => t.id === "viejo-1")!.tripCode, /^CAN-/);
  assert.equal(trips.find((t) => t.id === "viejo-2")!.tripCode, `${PREFIX}002`);
  assert.equal(calls[0], "lock", "el candado va antes de leer el último número");
  assert.equal(new Set(trips.map((t) => t.tripCode)).size, trips.length);
});

test("numeración: dos borradores abiertos no sacan el mismo número — el que se ingresa primero es el menor", async () => {
  const { tx, trips } = createTripsFakeTx([
    { id: "a", tripCode: "BOR-AAAA", status: "DRAFT" },
    { id: "b", tripCode: "BOR-BBBB", status: "DRAFT" },
  ]);
  assert.equal(await assignTripCodeTx(tx, "b"), `${PREFIX}001`);
  trips.find((t) => t.id === "b")!.status = "TRANSFERRED";
  assert.equal(await assignTripCodeTx(tx, "a"), `${PREFIX}002`);
});

test("numeración: un borrador viejo que ya tenía el número que le toca lo conserva", async () => {
  const { tx, trips } = createTripsFakeTx([{ id: "a", tripCode: `${PREFIX}001`, status: "DRAFT" }]);
  assert.equal(await assignTripCodeTx(tx, "a"), `${PREFIX}001`);
  assert.equal(trips[0].tripCode, `${PREFIX}001`);
});

test("numeración: compara números, no texto — después del 999 sigue el 1000 y no repite", () => {
  assert.equal(nextTripCodeFrom("VJM-2026-", []), "VJM-2026-001");
  assert.equal(nextTripCodeFrom("VJM-2026-", ["VJM-2026-999", "VJM-2026-1000"]), "VJM-2026-1001");
});

test("numeración: el año es el de Managua, no el de UTC", () => {
  assert.equal(tripCodePrefix(new Date("2027-01-01T03:00:00Z")), "VJM-2026-");
  assert.equal(tripCodePrefix(new Date("2027-01-01T07:00:00Z")), "VJM-2027-");
});

/** Enlace con el catálogo: el tercer número del nombre son varas. */

test("nombre con la convención del catálogo real", () => {
  assert.equal(timberCatalogName(1, 12, 6), "TABLA 1X12X6");
  assert.equal(timberCatalogName(2, 10, 6), "TABLA 2X10X6");
  assert.equal(timberCatalogName(1, 8, 3), "TABLILLA 1X8X3");
  assert.equal(timberCatalogName(1, 3, 6), "REGLA 1X3X6");
  assert.equal(timberCatalogName(2, 4, 6), "CUARTON 2X4X6");
  assert.equal(timberCatalogName(4, 4, 5), "CUARTON 4X4X5");
});

test("parseWoodDimensions reconoce TABLILLA (antes salía OTRO y el filtro de tipo no la encontraba)", () => {
  assert.equal(parseWoodDimensions("TABLILLA 1X6X3").subtype, "TABLILLA");
  assert.equal(parseWoodDimensions("TABLA 1X12X6").subtype, "TABLA");
});

test("elige el producto de medida exacta: activo y con el nombre esperado primero, sin confundir 1X2X6 con 11X2X6", () => {
  const line = { thicknessIn: 1, widthIn: 2, varaLength: 6 };
  assert.equal(pickCatalogWoodProduct([{ name: "REGLA 11X2X6", isActive: true }], line), null);
  assert.equal(
    pickCatalogWoodProduct(
      [{ name: "REGLA 1X2X6 CEDRO", isActive: true }, { name: "regla 1x2x6", isActive: false }, { name: "REGLA 1X2X6", isActive: true }],
      line,
    )?.name,
    "REGLA 1X2X6",
  );
  assert.equal(pickCatalogWoodProduct([{ name: "REGLA 1x2x6", isActive: false }], line)?.name, "REGLA 1x2x6");
});

function tripLine(thicknessIn: number, widthIn: number, lengthIn: number, varaLength: number): TimberTripLine {
  return {
    timberProductId: null,
    thicknessIn,
    widthIn,
    lengthIn,
    varaLength,
    priceGroup: "CUADRO",
    pieces: 10,
    calculatedFeet: new Prisma.Decimal((thicknessIn * widthIn * lengthIn * 10) / 12),
    calculatedCostPerPiece: new Prisma.Decimal(100),
    calculatedSalePricePerPiece: new Prisma.Decimal(200),
  } as unknown as TimberTripLine;
}

function createCatalogFakeTx(products: Array<{ id: string; sku: string; name: string; isActive: boolean; isTimber: boolean }>) {
  const catalog = products.map((product) => ({ ...product, timberProduct: null as { id: string } | null }));
  const timberCreated: Array<Record<string, unknown>> = [];
  const productsCreated: Array<Record<string, unknown>> = [];
  const productUpdates: Array<Record<string, unknown>> = [];
  const tx = {
    timberProduct: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async (args: { data: { productId: string } }) => {
        timberCreated.push(args.data);
        const row = { id: `tp-${timberCreated.length}` };
        const owner = catalog.find((p) => p.id === args.data.productId);
        if (owner) owner.timberProduct = row;
        return row;
      },
    },
    product: {
      findMany: async () => catalog,
      create: async (args: { data: { name: string; sku: string } }) => {
        productsCreated.push(args.data);
        return { id: "creado", ...args.data };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        productUpdates.push({ id: args.where.id, ...args.data });
        return args.data;
      },
    },
    category: { findUnique: async () => ({ id: "cat-madera" }) },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, timberCreated, productsCreated, productUpdates };
}

test("el viaje entra al producto del catálogo que vende el POS: REGLA 1X3X6 (1×3×16 pies) se enlaza, no se duplica", async () => {
  const { tx, timberCreated, productsCreated, productUpdates } = createCatalogFakeTx([
    { id: "regla", sku: "MAD-REG-136-0001", name: "REGLA 1X3X6", isActive: true, isTimber: false },
  ]);
  const result = await resolveTimberProductIdentityTx(tx, tripLine(1, 3, 16, 6));
  assert.equal(result.productId, "regla");
  assert.equal(result.isNewProduct, false);
  assert.equal(productsCreated.length, 0, "antes creaba MAD-CUA-1x3x16 con el stock aparte");
  assert.equal(timberCreated[0].productId, "regla");
  assert.deepEqual(productUpdates, [{ id: "regla", isActive: true, isTimber: true }]);
});

test("14 y 15 pies son las mismas 5 varas: la segunda línea reutiliza la medida enlazada por la primera", async () => {
  const { tx, timberCreated } = createCatalogFakeTx([
    { id: "cuarton", sku: "MAD-CUA-285-0001", name: "CUARTON 2X8X5", isActive: true, isTimber: false },
  ]);
  const first = await resolveTimberProductIdentityTx(tx, tripLine(2, 8, 14, 5));
  const second = await resolveTimberProductIdentityTx(tx, tripLine(2, 8, 15, 5));
  assert.equal(second.timberProductId, first.timberProductId);
  assert.equal(timberCreated.length, 1);
});

test("stock entrante a un producto inactivo: se reactiva, si no quedaría invisible en el POS", async () => {
  const { tx, productUpdates, productsCreated } = createCatalogFakeTx([
    { id: "tabla", sku: "MAD-TAB-1126-0001", name: "TABLA 1X12X6", isActive: false, isTimber: false },
  ]);
  await resolveTimberProductIdentityTx(tx, tripLine(1, 12, 16, 6));
  assert.equal(productsCreated.length, 0);
  assert.deepEqual(productUpdates, [{ id: "tabla", isActive: true, isTimber: true }]);
});

test("medida que no está en el catálogo: se crea con el nombre y SKU de la convención, no MAD-TAB-1x12x16", async () => {
  const { tx, productsCreated, timberCreated } = createCatalogFakeTx([]);
  const result = await resolveTimberProductIdentityTx(tx, tripLine(2, 8, 16, 6));
  assert.equal(result.isNewProduct, true);
  assert.equal(productsCreated[0].name, "CUARTON 2X8X6");
  assert.equal(productsCreated[0].sku, "MAD-CUA-286-0001");
  assert.equal(productsCreated[0].unit, "UNIDAD");
  assert.equal(timberCreated[0].productId, "creado");
});

/** Búsqueda */

test("búsqueda: sin distinguir mayúsculas, palabra por palabra, y la medida en pies encuentra el nombre en varas", () => {
  const where = JSON.stringify(timberProductSearchWhere("cuarton 2x4x16", DEFAULT_CUBICATION_TABLE));
  assert.ok(where.includes('"CUARTON"'));
  assert.ok(where.includes('"2X4X16"'));
  assert.ok(where.includes('"2X4X6"'), "2×4×16 pies es el CUARTON 2X4X6");
  assert.ok(where.includes('"insensitive"'));
  assert.ok(!JSON.stringify(timberProductSearchWhere("2x4", DEFAULT_CUBICATION_TABLE)).includes("X6"));
});
