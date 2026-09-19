import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { getSaleStockAvailabilityBatchTx, getSaleStockAvailabilityTx } from "@/modules/inventory/service";

/**
 * Bug real reportado por el usuario tras la fusión triple: "no convierte en
 * automatico" al vender Libra/Unidad. Causa: getSaleStockAvailabilityTx
 * comparaba requestedQty (en la unidad de venta del producto pedido, ej.
 * LIBRA factor≈0.4536) directo contra el stock suelto disponible (en
 * unidades BASE, ej. KILO) — sin convertir. En el modelo dual viejo esto
 * nunca se notaba: el único no-empaque posible era el canónico (factor=1,
 * base y venta son la misma unidad). Con una presentación suelta
 * alternativa de factor≠1, comparar sin convertir rechazaba ventas con
 * stock de sobra (o aceptaba ventas sin stock suficiente), según los
 * números — el POS "no convertía": no dejaba vender ni abrir la caja.
 */

const BRANCH_ID = "branch-mga";
const CANONICAL_ID = "prod-clavo-unidad"; // KILO en unidades — canónico, factor=1
const CAJA_ID = "prod-clavo-caja";
const LIBRA_ID = "prod-clavo-libra";
const CAJA_FACTOR = 25; // 1 caja = 25 kg
const LIBRA_FACTOR = 0.453592; // 1 libra ≈ 0.453592 kg

function createFakeTx(input: {
  closedPackageQuantity: number;
  looseUnitQuantity: number;
  minimumClosedPackageReserve?: number;
  autoOpenForUnitSale?: boolean;
}) {
  const balance = {
    branchId: BRANCH_ID,
    productId: CANONICAL_ID,
    quantityOnHand: new Prisma.Decimal(input.closedPackageQuantity * CAJA_FACTOR + input.looseUnitQuantity),
    closedPackageQuantity: new Prisma.Decimal(input.closedPackageQuantity),
    looseUnitQuantity: new Prisma.Decimal(input.looseUnitQuantity),
    weightedAverageCost: new Prisma.Decimal(0),
  };

  const groupProductsSummary = [
    { productId: CANONICAL_ID, isCanonical: true, conversionFactor: new Prisma.Decimal(1) },
    { productId: CAJA_ID, isCanonical: false, conversionFactor: new Prisma.Decimal(CAJA_FACTOR) },
    { productId: LIBRA_ID, isCanonical: false, conversionFactor: new Prisma.Decimal(LIBRA_FACTOR) },
  ];

  const memberRow = (productId: string) => {
    if (productId === CANONICAL_ID) return { productId, isCanonical: true, isPackagePresentation: false, conversionFactor: new Prisma.Decimal(1), saleUnit: "UNIDAD" };
    if (productId === CAJA_ID) return { productId, isCanonical: false, isPackagePresentation: true, conversionFactor: new Prisma.Decimal(CAJA_FACTOR), saleUnit: "CAJA" };
    if (productId === LIBRA_ID) return { productId, isCanonical: false, isPackagePresentation: false, conversionFactor: new Prisma.Decimal(LIBRA_FACTOR), saleUnit: "LIBRA" };
    return null;
  };

  const fullMemberRow = (productId: string) => {
    const member = memberRow(productId);
    if (!member) return null;
    return {
      ...member,
      stockGroupId: "group-clavo",
      stockGroup: {
        id: "group-clavo",
        code: "CLAVO_2",
        name: "Clavo acero 2\"",
        baseUnit: "UNIDAD",
        packageUnit: "CAJA",
        conversionFactorToBase: new Prisma.Decimal(CAJA_FACTOR),
        tracksPackages: true,
        approximateFactor: true,
        minimumClosedPackageReserve: new Prisma.Decimal(input.minimumClosedPackageReserve ?? 1),
        autoOpenForUnitSale: input.autoOpenForUnitSale ?? true,
        products: groupProductsSummary,
      },
    };
  };

  return {
    productStockGroupMember: {
      findFirst: async (args: { where: { productId?: string } }) => (args.where.productId ? fullMemberRow(args.where.productId) : null),
      // getProductStockConversionsBatch (Fase 1, prompt-flujo-velocidad.md) —
      // getSaleStockAvailabilityTx ahora es un envoltorio del batch, que
      // resuelve conversiones con findMany en vez de findFirst por producto.
      findMany: async (args: { where: { productId: { in: string[] } } }) =>
        args.where.productId.in.map((id) => fullMemberRow(id)).filter((row): row is NonNullable<typeof row> => row !== null),
    },
    inventoryBalance: {
      findUnique: async () => balance,
      findMany: async (args: { where: { productId: { in: string[] } } }) =>
        args.where.productId.in.includes(CANONICAL_ID) ? [balance] : [],
    },
    productionBatchInput: {
      // Sin reservas de producción en juego en este archivo — la rama
      // STANDARD (insumos de producción) no es la que este archivo prueba.
      findMany: async () => [],
    },
  } as unknown as Prisma.TransactionClient;
}

test("Libra: 100 kilos sueltos alcanzan de sobra para vender 60 libras (~27kg) — antes rechazaba por comparar sin convertir", async () => {
  const tx = createFakeTx({ closedPackageQuantity: 0, looseUnitQuantity: 100 });
  const result = await getSaleStockAvailabilityTx(tx, { branchId: BRANCH_ID, productId: LIBRA_ID, quantity: 60 });
  assert.equal(result.ok, true, "60 libras (~27kg) deben caber en 100kg sueltos disponibles");
});

test("Unidad: 50 kilos sueltos alcanzan de sobra para vender 100 clavos — antes rechazaba comparando 50 (kg) contra 100 (unidades)", async () => {
  // Reutiliza el canónico mismo (factor=1) no dispara el bug; se prueba
  // contra un tercer miembro de conteo con factor propio distinto de 1.
  const UNIDAD_FACTOR = 0.005; // 200 unidades por kilo
  const tx = createFakeTx({ closedPackageQuantity: 0, looseUnitQuantity: 50 });
  // Registra un cuarto miembro "unidad de conteo" ad-hoc reutilizando LIBRA_ID
  // con otro factor no es fiel — en su lugar probamos directo la conversión
  // de disponibilidad para LIBRA con un factor de conteo simulado.
  const adhocMember = {
    productId: LIBRA_ID, isCanonical: false, isPackagePresentation: false, conversionFactor: new Prisma.Decimal(UNIDAD_FACTOR), saleUnit: "UNIDAD",
    stockGroupId: "group-clavo",
    stockGroup: {
      id: "group-clavo", code: "CLAVO_2", name: "Clavo acero 2\"", baseUnit: "UNIDAD", packageUnit: "CAJA",
      conversionFactorToBase: new Prisma.Decimal(CAJA_FACTOR), tracksPackages: true, approximateFactor: true,
      minimumClosedPackageReserve: new Prisma.Decimal(1), autoOpenForUnitSale: true,
      products: [
        { productId: CANONICAL_ID, isCanonical: true, conversionFactor: new Prisma.Decimal(1) },
        { productId: CAJA_ID, isCanonical: false, conversionFactor: new Prisma.Decimal(CAJA_FACTOR) },
      ],
    },
  };
  const result = await getSaleStockAvailabilityTx(
    { ...tx, productStockGroupMember: {
      findFirst: async () => adhocMember,
      findMany: async () => [adhocMember],
    } } as unknown as Prisma.TransactionClient,
    { branchId: BRANCH_ID, productId: LIBRA_ID, quantity: 100 },
  );
  assert.equal(result.ok, true, "100 unidades (0.5kg) deben caber en 50kg sueltos disponibles");
});

test("Libra: sin suficiente stock ni cajas para abrir, rechaza correctamente (no es un falso OK)", async () => {
  const tx = createFakeTx({ closedPackageQuantity: 0, looseUnitQuantity: 1 }); // 1kg suelto
  const result = await getSaleStockAvailabilityTx(tx, { branchId: BRANCH_ID, productId: LIBRA_ID, quantity: 60 }); // pide ~27kg
  assert.equal(result.ok, false, "1kg no alcanza para 60 libras (~27kg) sin cajas para abrir");
  assert.equal(result.reason, "INSUFFICIENT_LOOSE_AND_RESERVED_PACKAGE_STOCK");
});

test("Libra: con cajas cerradas de sobra para auto-abrir, alcanza (auto-apertura correctamente calculada en base)", async () => {
  // 3 cajas cerradas (75kg), reserva 1 -> 2 abribles (50kg) + 0 suelto.
  const tx = createFakeTx({ closedPackageQuantity: 3, looseUnitQuantity: 0, minimumClosedPackageReserve: 1, autoOpenForUnitSale: true });
  const result = await getSaleStockAvailabilityTx(tx, { branchId: BRANCH_ID, productId: LIBRA_ID, quantity: 60 }); // ~27kg
  assert.equal(result.ok, true, "50kg abribles deben alcanzar para 60 libras (~27kg)");
  assert.equal(result.stockMode, "LOOSE_WITH_AUTO_OPEN");
});

test("Caja: comprar por empaque sigue comparando 1 a 1 contra closedPackageQuantity (no debe convertirse por el factor)", async () => {
  const tx = createFakeTx({ closedPackageQuantity: 3, looseUnitQuantity: 0 });
  const result = await getSaleStockAvailabilityTx(tx, { branchId: BRANCH_ID, productId: CAJA_ID, quantity: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.stockMode, "PACKAGE");
});

/**
 * prompt-flujo-velocidad.md Fase 1: getSaleStockAvailabilityBatchTx resuelve
 * varias líneas de una orden en una sola llamada. El schema no impide dos
 * líneas con el mismo productId en una orden (SaleOrderLine no tiene unique
 * en [saleOrderId, productId]) — el loop viejo chequeaba cada línea contra
 * el MISMO balance sin sumar (ya era un hueco: 60+60 libras, cada una
 * chequeada sola contra 30kg, pasaban las dos). La versión batch agrega la
 * cantidad por productId ANTES de comparar, así que ahora sí rechaza
 * correctamente la demanda combinada.
 */
test("batch: dos líneas del mismo producto sí sé suman contra el balance (no pasan dos veces por separado)", async () => {
  const tx = createFakeTx({ closedPackageQuantity: 0, looseUnitQuantity: 30 }); // 30kg sueltos
  const result = await getSaleStockAvailabilityBatchTx(tx, {
    branchId: BRANCH_ID,
    lines: [
      { productId: LIBRA_ID, quantity: 60 }, // ~27.2kg — sola, cabe en 30kg
      { productId: LIBRA_ID, quantity: 60 }, // otra línea del mismo producto — juntas, ~54.4kg > 30kg
    ],
  });
  const availability = result.get(LIBRA_ID);
  assert.equal(availability?.ok, false, "120 libras combinadas (~54kg) no caben en 30kg sueltos, aunque cada línea sola sí pasaría");
  assert.equal(availability?.reason, "INSUFFICIENT_LOOSE_AND_RESERVED_PACKAGE_STOCK");
});

test("batch: resuelve varios productos distintos en una sola llamada, cada uno con su propio veredicto", async () => {
  const tx = createFakeTx({ closedPackageQuantity: 3, looseUnitQuantity: 30 });
  const result = await getSaleStockAvailabilityBatchTx(tx, {
    branchId: BRANCH_ID,
    lines: [
      { productId: CAJA_ID, quantity: 2 }, // 2 cajas de 3 cerradas -> ok
      { productId: LIBRA_ID, quantity: 60 }, // ~27kg de 30kg sueltos -> ok
    ],
  });
  assert.equal(result.size, 2);
  assert.equal(result.get(CAJA_ID)?.ok, true);
  assert.equal(result.get(CAJA_ID)?.stockMode, "PACKAGE");
  assert.equal(result.get(LIBRA_ID)?.ok, true);
  assert.equal(result.get(LIBRA_ID)?.stockMode, "LOOSE_WITH_AUTO_OPEN");
});
