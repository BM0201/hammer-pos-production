import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { previewIntake } from "@/modules/inventory/intake-preview-service";

/**
 * Fase 1 (prompt-entrada-inventario.md) — fake-db a medida de lo que
 * previewIntake necesita (todo por lote): product/branchProductSetting/
 * inventoryBalance.findMany (para getEffectiveProductPricingBatch y el
 * balance directo), productStockGroupMember.findMany vacío (sin fusión en
 * estos escenarios — ya cubierto en otro lado), purchaseOrder/
 * purchaseOrderLine.findMany (OC pendiente y "compra típica").
 */
function decimal(value: number) {
  return new Prisma.Decimal(value);
}

const BRANCH_1 = "branch-1";
const BRANCH_2 = "branch-2";

type ProductFixture = { id: string; isActive?: boolean; standardSalePrice?: number; averageCost?: number | null; globalCost?: number | null; lastPurchaseCost?: number | null; costUpdatedAt?: Date | null; mergedIntoProductId?: string | null; mergedInto?: { sku: string; name: string } | null; categoryId?: string };
/** Commit 3 (prompt-entrada-reintento-precio.md) — "política de la categoría" (resolvePolicyForProductBatch). Ausente = usa el default real de FALLBACK_POLICY_DEFAULTS (15%), igual que producción sin PricingConfig ni BranchCategoryPricingPolicy. */
type CategoryPolicyFixture = { branchId: string; categoryId: string; minMarginPercent: number; targetMarginPercent?: number };
type BalanceFixture = { branchId: string; productId: string; quantityOnHand: number; weightedAverageCost: number };
type BranchSettingFixture = { branchId: string; productId: string; branchCost?: number | null; branchPrice?: number | null };
type ApprovedPoFixture = { id: string; orderNumber: string; branchId: string; productIds: string[] };
type PoLineFixture = { branchId: string; productId: string; quantity: number };

type FusionMemberFixture = { productId: string; stockGroupId: string; isCanonical: boolean; conversionFactor: number; saleUnit?: string; isPackagePresentation?: boolean };

function buildFakeDb(opts: {
  products?: ProductFixture[];
  balances?: BalanceFixture[];
  branchSettings?: BranchSettingFixture[];
  approvedPOs?: ApprovedPoFixture[];
  poLines?: PoLineFixture[];
  fusionMembers?: FusionMemberFixture[];
  categoryPolicies?: CategoryPolicyFixture[];
} = {}) {
  const products = opts.products ?? [];
  const balances = opts.balances ?? [];
  const branchSettings = opts.branchSettings ?? [];
  const approvedPOs = opts.approvedPOs ?? [];
  const poLines = opts.poLines ?? [];
  const fusionMembers = opts.fusionMembers ?? [];
  const categoryPolicies = opts.categoryPolicies ?? [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake db, shape dictado por los selects reales de cada llamador.
  const db: any = {
    systemSetting: { findUnique: async () => null },
    // prompt-entrada-multisucursal-fix.md — réplica mínima de
    // getProductStockConversionsBatch (unit-conversion.ts): agrupa los
    // miembros por stockGroupId y arma, para cada fila, el mismo "products"
    // que ve el canónico (necesario para encontrar isCanonical).
    productStockGroupMember: {
      findMany: async ({ where }: { where: { productId: { in: string[] } } }) => {
        const relevant = fusionMembers.filter((m) => where.productId.in.includes(m.productId));
        return relevant.map((m) => {
          const groupPeers = fusionMembers.filter((g) => g.stockGroupId === m.stockGroupId);
          return {
            productId: m.productId,
            stockGroupId: m.stockGroupId,
            conversionFactor: decimal(m.conversionFactor),
            saleUnit: m.saleUnit ?? "UN",
            isPackagePresentation: m.isPackagePresentation ?? false,
            stockGroup: {
              code: m.stockGroupId,
              name: m.stockGroupId,
              baseUnit: "UN",
              packageUnit: null,
              conversionFactorToBase: null,
              tracksPackages: false,
              approximateFactor: false,
              minimumClosedPackageReserve: decimal(0),
              autoOpenForUnitSale: false,
              products: groupPeers.map((g) => ({ productId: g.productId, isCanonical: g.isCanonical, conversionFactor: decimal(g.conversionFactor) })),
            },
          };
        });
      },
    },
    product: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        products
          .filter((p) => where.id.in.includes(p.id))
          .map((p) => ({
            id: p.id,
            isActive: p.isActive ?? true,
            standardSalePrice: decimal(p.standardSalePrice ?? 100),
            globalCost: p.globalCost != null ? decimal(p.globalCost) : null,
            averageCost: p.averageCost != null ? decimal(p.averageCost) : null,
            lastPurchaseCost: p.lastPurchaseCost != null ? decimal(p.lastPurchaseCost) : null,
            costUpdatedAt: p.costUpdatedAt ?? null,
            mergedIntoProductId: p.mergedIntoProductId ?? null,
            mergedInto: p.mergedInto ?? null,
            // resolvePolicyForProductBatch (Commit 3) — mismo mock, otro select.
            categoryId: p.categoryId ?? "cat-default",
            category: { code: "GEN", name: "General" },
          })),
    },
    // Commit 3 — "política de la categoría" (resolvePolicyForProductBatch).
    // Sin fixtures (default): ningún test de antes de este commit configura
    // esto, así que cae al default real de PricingConfig/FALLBACK_POLICY_DEFAULTS
    // (15%) — nunca dispara MARGIN_BELOW_POLICY por accidente.
    branchCategoryPricingPolicy: {
      findMany: async ({ where }: { where: { branchId: { in: string[] }; categoryId: { in: string[] } } }) =>
        categoryPolicies
          .filter((p) => where.branchId.in.includes(p.branchId) && where.categoryId.in.includes(p.categoryId))
          .map((p) => ({ id: `policy-${p.branchId}-${p.categoryId}`, branchId: p.branchId, categoryId: p.categoryId, minMarginPercent: decimal(p.minMarginPercent), targetMarginPercent: decimal(p.targetMarginPercent ?? 30), minProfitAmount: decimal(0), maxDiscountPercent: decimal(0), estimatedMonthlyUnits: decimal(1), estimatedMonthlySalesValue: null, monthlyExpenseAllocation: decimal(0), stockPolicy: "NORMAL", priceMode: "CATEGORY", roundingRule: "NEAREST_1", isActive: true, notes: null, category: { code: "GEN", name: "General" } })),
    },
    pricingConfig: {
      findMany: async () => [],
    },
    // prompt-entrada-multisucursal-fix.md — códigos de sucursal para
    // lineMessages agrupados; ningún test de este archivo verifica el
    // texto exacto de branchCodes, así que basta con un eco del id.
    branch: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, code: id })),
    },
    branchProductSetting: {
      findMany: async ({ where }: { where: { productId: { in: string[] }; branchId: { in: string[] } } }) =>
        branchSettings
          .filter((s) => where.productId.in.includes(s.productId) && where.branchId.in.includes(s.branchId))
          .map((s) => ({ branchId: s.branchId, productId: s.productId, branchPrice: s.branchPrice != null ? decimal(s.branchPrice) : null, branchCost: s.branchCost != null ? decimal(s.branchCost) : null })),
    },
    inventoryBalance: {
      findMany: async ({ where }: { where: { productId: { in: string[] }; branchId: { in: string[] } } }) =>
        balances
          .filter((b) => where.productId.in.includes(b.productId) && where.branchId.in.includes(b.branchId))
          .map((b) => ({ branchId: b.branchId, productId: b.productId, quantityOnHand: decimal(b.quantityOnHand), weightedAverageCost: decimal(b.weightedAverageCost) })),
    },
    purchaseOrder: {
      findMany: async ({ where }: { where: { branchId: { in: string[] }; lines: { some: { productId: { in: string[] } } } } }) =>
        approvedPOs
          .filter((po) => where.branchId.in.includes(po.branchId) && po.productIds.some((id) => where.lines.some.productId.in.includes(id)))
          .map((po) => ({ id: po.id, orderNumber: po.orderNumber, branchId: po.branchId, lines: po.productIds.filter((id) => where.lines.some.productId.in.includes(id)).map((id) => ({ productId: id })) })),
    },
    purchaseOrderLine: {
      findMany: async ({ where }: { where: { productId: { in: string[] }; purchaseOrder: { branchId: { in: string[] } } } }) =>
        poLines
          .filter((l) => where.productId.in.includes(l.productId) && where.purchaseOrder.branchId.in.includes(l.branchId))
          .map((l) => ({ productId: l.productId, quantity: decimal(l.quantity), purchaseOrder: { branchId: l.branchId } })),
    },
  };
  return db;
}

test("LA QUE IMPORTA — ADD_STOCK con costo PROMEDIA de verdad en la vista previa (120 a 402.30 + 50 a 415 → 406.04), igual que el servicio real", async () => {
  const db = buildFakeDb({
    // standardSalePrice realista frente al costo (415) — nada que ver con
    // lo que este test verifica (el promedio de WAC), pero con el default
    // de 100 el margen quedaría negativo y dispararía MARGIN_BELOW_POLICY
    // (Commit 3), que es correcto mas no lo que este test puntual mide.
    products: [{ id: "p1", standardSalePrice: 600 }],
    balances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 120, weightedAverageCost: 402.3 }],
  });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: 50, unitCost: 415 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.currentQty, 120);
  assert.equal(cell.finalQty, 170);
  assert.equal(cell.delta, 50);
  assert.equal(cell.currentWac, 402.3);
  assert.equal(Number(cell.newWac!.toFixed(2)), 406.04);
  assert.equal(cell.status, "OK");
});

test("PHYSICAL_COUNT nunca calcula newWac, aunque el conteo suba el stock", async () => {
  const db = buildFakeDb({
    products: [{ id: "p1" }],
    balances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 40, weightedAverageCost: 402.3 }],
  });
  const result = await previewIntake({ kind: "PHYSICAL_COUNT", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: 60 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.newWac, null, "un conteo no promedia costo, aunque suba el stock");
});

test("OPENING_BALANCE sobre un producto con existencias → ERROR OPENING_BALANCE_HAS_STOCK", async () => {
  const db = buildFakeDb({
    products: [{ id: "p1" }],
    balances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 15, weightedAverageCost: 50 }],
  });
  const result = await previewIntake({ kind: "OPENING_BALANCE", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: 10, unitCost: 60 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.status, "ERROR");
  assert.ok(cell.messages.some((m) => m.code === "OPENING_BALANCE_HAS_STOCK"));
});

test("LA QUE IMPORTA — OC pendiente del mismo producto/sucursal → REVIEW con el poId para el botón 'Recibir OC-XXXX'", async () => {
  const db = buildFakeDb({
    products: [{ id: "p-oc" }],
    approvedPOs: [{ id: "po-1", orderNumber: "OC-000123", branchId: BRANCH_1, productIds: ["p-oc"] }],
  });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "p-oc", quantity: 20, unitCost: 80 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.status, "REVIEW");
  const msg = cell.messages.find((m) => m.code === "PENDING_PURCHASE_ORDER");
  assert.ok(msg, "debe avisar la OC pendiente");
  assert.equal(msg!.poId, "po-1");
});

test("producto inactivo → ERROR PRODUCT_BLOCKED", async () => {
  const db = buildFakeDb({ products: [{ id: "p-inactive", isActive: false }] });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "p-inactive", quantity: 5, unitCost: 10 }] }, db);
  assert.equal(result.cells[0].status, "ERROR");
  assert.ok(result.cells[0].messages.some((m) => m.code === "PRODUCT_BLOCKED"));
});

test("LA QUE IMPORTA — cantidad muy por encima de la compra típica (mediana de OC) → REVIEW", async () => {
  const db = buildFakeDb({
    products: [{ id: "p-typical" }],
    poLines: [
      { branchId: BRANCH_1, productId: "p-typical", quantity: 10 },
      { branchId: BRANCH_1, productId: "p-typical", quantity: 12 },
      { branchId: BRANCH_1, productId: "p-typical", quantity: 11 },
      { branchId: BRANCH_1, productId: "p-typical", quantity: 9 },
      { branchId: BRANCH_1, productId: "p-typical", quantity: 10 },
    ],
  });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "p-typical", quantity: 150, unitCost: 50 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.status, "REVIEW");
  assert.ok(cell.messages.some((m) => m.code === "QUANTITY_FAR_ABOVE_TYPICAL"));
});

test("cantidad vacía (borrador a medio llenar) → ERROR MISSING_QUANTITY, no mueve finalQty ni entra en los totales", async () => {
  const db = buildFakeDb({ products: [{ id: "p1" }], balances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 8, weightedAverageCost: 20 }] });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: null, unitCost: 25 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.status, "ERROR");
  assert.ok(cell.messages.some((m) => m.code === "MISSING_QUANTITY"));
  assert.equal(cell.finalQty, 8, "sin cantidad, el stock final queda igual al actual");
  assert.equal(result.totals[BRANCH_1].units, 0);
});

test("override por sucursal: la misma línea entra distinta cantidad en cada sucursal", async () => {
  const db = buildFakeDb({ products: [{ id: "p1" }] });
  const result = await previewIntake({
    kind: "ADD_STOCK",
    branchIds: [BRANCH_1, BRANCH_2],
    lines: [{ productId: "p1", quantity: 10, unitCost: 50, overrides: { [BRANCH_2]: 25 } }],
  }, db);
  const b1Cell = result.cells.find((c) => c.branchId === BRANCH_1)!;
  const b2Cell = result.cells.find((c) => c.branchId === BRANCH_2)!;
  assert.equal(b1Cell.delta, 10, "sin override, usa la cantidad general");
  assert.equal(b2Cell.delta, 25, "con override, usa el valor específico de la sucursal");
});

test("totales por sucursal: suma unidades y valor de varias líneas OK", async () => {
  const db = buildFakeDb({ products: [{ id: "pA" }, { id: "pB" }] });
  const result = await previewIntake({
    kind: "ADD_STOCK",
    branchIds: [BRANCH_1],
    lines: [
      { productId: "pA", quantity: 10, unitCost: 100 },
      { productId: "pB", quantity: 5, unitCost: 50 },
    ],
  }, db);
  assert.equal(result.totals[BRANCH_1].units, 15);
  assert.equal(result.totals[BRANCH_1].value, 1250);
  assert.equal(result.totals[BRANCH_1].wacChanges, 2, "ambas partían de 0 existencias — las dos calculan un WAC nuevo");
});

test("conteo a la baja SIN costo (no es entrada, no necesita costo) deja el total de valor en null para esa sucursal", async () => {
  const db = buildFakeDb({ products: [{ id: "p1" }], balances: [{ branchId: BRANCH_1, productId: "p1", quantityOnHand: 20, weightedAverageCost: 0 }] });
  const result = await previewIntake({ kind: "PHYSICAL_COUNT", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: 12 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.status, "OK", "una baja de 40% no dispara el aviso de 'baja fuerte' (umbral 50%)");
  assert.equal(result.totals[BRANCH_1].units, 8);
  assert.equal(result.totals[BRANCH_1].value, null, "sin costo propio ni efectivo, no se puede valorizar esta salida");
});

test("lastPurchaseCost/fecha salen de Product (global, no por sucursal) — igual que el resto del sistema", async () => {
  const costUpdatedAt = new Date("2026-09-01T00:00:00.000Z");
  const db = buildFakeDb({ products: [{ id: "p1", lastPurchaseCost: 123.45, costUpdatedAt }] });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: 5, unitCost: 10 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.lastPurchaseCost, 123.45);
  assert.equal(cell.lastPurchaseDate, costUpdatedAt.toISOString());
});

// ── prompt-entrada-multisucursal-fix.md ─────────────────────────────────

test("LA QUE IMPORTA — un miembro DERIVADO de una fusión se acepta (no es un producto unificado) y mueve el canónico con el factor", async () => {
  const db = buildFakeDb({
    products: [{ id: "canonico" }, { id: "derivado" }],
    balances: [{ branchId: BRANCH_1, productId: "canonico", quantityOnHand: 100, weightedAverageCost: 20 }],
    fusionMembers: [
      { productId: "canonico", stockGroupId: "g1", isCanonical: true, conversionFactor: 1, saleUnit: "UN" },
      { productId: "derivado", stockGroupId: "g1", isCanonical: false, conversionFactor: 14, saleUnit: "QQ" },
    ],
  });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "derivado", quantity: 2, unitCost: 300 }] }, db);
  const cell = result.cells[0];
  assert.notEqual(cell.status, "ERROR", "una presentación de fusión NUNCA es 'producto unificado'");
  assert.ok(!cell.messages.some((m) => m.code === "PRODUCT_BLOCKED"));
  // 2 unidades del derivado (factor 14) = 28 de base, sobre 100 ya existentes del canónico.
  assert.equal(cell.currentQty, 100);
  assert.equal(cell.finalQty, 128);
});

test("producto con mergedIntoProductId → PRODUCT_BLOCKED con el nombre del principal, no 'inactivo' ni 'unificado' genérico", async () => {
  const db = buildFakeDb({
    products: [{ id: "p-merged", mergedIntoProductId: "p-survivor", mergedInto: { sku: "SKU-1", name: "Producto Principal" } }],
  });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "p-merged", quantity: 5, unitCost: 10 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.status, "ERROR");
  const msg = cell.messages.find((m) => m.code === "PRODUCT_BLOCKED")!;
  assert.ok(msg.text.includes("Producto Principal"));
  assert.equal(cell.messages.length, 1, "bloqueado no evalúa cantidad/costo además — un solo mensaje");
});

test("LA QUE IMPORTA — 0 en una sucursal: SKIPPED, sin mensajes, no entra en los totales; la otra sucursal (con cantidad real) sigue OK", async () => {
  const db = buildFakeDb({ products: [{ id: "p1" }] });
  const result = await previewIntake({
    kind: "ADD_STOCK",
    branchIds: [BRANCH_1, BRANCH_2],
    lines: [{ productId: "p1", quantity: 100, unitCost: 50, overrides: { [BRANCH_2]: 0 } }],
  }, db);
  const cellB1 = result.cells.find((c) => c.branchId === BRANCH_1)!;
  const cellB2 = result.cells.find((c) => c.branchId === BRANCH_2)!;
  assert.equal(cellB1.status, "OK");
  assert.equal(cellB2.status, "SKIPPED");
  assert.deepEqual(cellB2.messages, []);
  assert.equal(result.totals[BRANCH_2].units, 0, "la sucursal que no lleva no suma nada a sus totales");
  assert.equal(result.totals[BRANCH_1].units, 100);
});

test("LA QUE IMPORTA — todas las sucursales elegidas en 0 para una línea: error de línea 'Elegí al menos una sucursal con cantidad', no SKIPPED silencioso", async () => {
  const db = buildFakeDb({ products: [{ id: "p1" }] });
  const result = await previewIntake({
    kind: "ADD_STOCK",
    branchIds: [BRANCH_1, BRANCH_2],
    lines: [{ productId: "p1", quantity: 0, unitCost: 50 }],
  }, db);
  assert.ok(result.cells.every((c) => c.status === "ERROR"));
  assert.ok(result.cells.every((c) => c.messages.some((m) => m.code === "ALL_BRANCHES_SKIPPED")));
  assert.equal(result.lineMessages["p1"]?.length, 1);
  assert.equal(result.lineMessages["p1"]![0].code, "ALL_BRANCHES_SKIPPED");
});

test("PHYSICAL_COUNT con 0: sigue siendo un conteo válido (no SKIPPED, no ALL_BRANCHES_SKIPPED) — 0 en conteo es un valor real, no 'no lleva'", async () => {
  // Sin balance previo (currentQty=0): contar 0 no es ninguna baja — nada que avisar.
  const db = buildFakeDb({ products: [{ id: "p1" }] });
  const result = await previewIntake({ kind: "PHYSICAL_COUNT", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: 0 }] }, db);
  assert.notEqual(result.cells[0].status, "SKIPPED");
  assert.equal(result.lineMessages["p1"], undefined);
});

test("LA QUE IMPORTA — sin costo en una sola sucursal de dos: lineMessages agrupa NO_COST_NO_AVERAGE con el código de ESA sucursal nada más, texto legible (no ids)", async () => {
  const db = buildFakeDb({
    products: [{ id: "p1" }],
    branchSettings: [{ branchId: BRANCH_1, productId: "p1", branchCost: 40 }], // BRANCH_1 sí tiene costo; BRANCH_2 no tiene ninguno.
  });
  const result = await previewIntake({
    kind: "ADD_STOCK",
    branchIds: [BRANCH_1, BRANCH_2],
    lines: [{ productId: "p1", quantity: 10 }], // sin unitCost — depende del costo efectivo de cada sucursal.
  }, db);
  const cellB1 = result.cells.find((c) => c.branchId === BRANCH_1)!;
  const cellB2 = result.cells.find((c) => c.branchId === BRANCH_2)!;
  assert.equal(cellB1.status, "OK", "BRANCH_1 tiene costo propio");
  assert.equal(cellB2.status, "ERROR");
  const grouped = result.lineMessages["p1"]!;
  const noCostGroup = grouped.find((m) => m.code === "NO_COST_NO_AVERAGE")!;
  assert.deepEqual(noCostGroup.branchCodes, [BRANCH_2], "solo la sucursal que de verdad no tiene costo, no las dos");
  assert.ok(!noCostGroup.text.includes(BRANCH_1), "el texto agrupado nunca mezcla ids/códigos de sucursales no afectadas");
});

// ── prompt-entrada-reintento-precio.md Commit 3 — precio de venta por sucursal ──

test("LA QUE IMPORTA — salePriceOverrides por sucursal gana sobre salePrice general", async () => {
  const db = buildFakeDb({
    products: [{ id: "p1", standardSalePrice: 100 }],
    categoryPolicies: [{ branchId: BRANCH_1, categoryId: "cat-default", minMarginPercent: 10 }, { branchId: BRANCH_2, categoryId: "cat-default", minMarginPercent: 10 }],
  });
  const result = await previewIntake({
    kind: "ADD_STOCK",
    branchIds: [BRANCH_1, BRANCH_2],
    lines: [{ productId: "p1", quantity: 10, unitCost: 50, salePrice: 200, salePriceOverrides: { [BRANCH_1]: 60 } }],
  }, db);
  const cellB1 = result.cells.find((c) => c.branchId === BRANCH_1)!;
  const cellB2 = result.cells.find((c) => c.branchId === BRANCH_2)!;
  // BRANCH_1 usa el override (60) contra costo 50 -> margen (60-50)/60=16.7%, por encima del 10% mínimo: OK.
  assert.ok(!cellB1.messages.some((m) => m.code === "MARGIN_BELOW_POLICY"));
  assert.ok(!cellB1.messages.some((m) => m.code === "PRICE_BELOW_COST"));
  // BRANCH_2 usa el general (200) contra el mismo costo -> margen alto, también OK, pero con otro precio.
  assert.equal(cellB2.status, "OK");
});

test("sin precio en absoluto (ni override, ni general, ni vigente): avisa 'sin precio', nunca bloquea ni fuerza un valor", async () => {
  const db = buildFakeDb({ products: [{ id: "p1", standardSalePrice: 0 }] }); // "0" = nunca se configuró un precio
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: 10, unitCost: 50 }] }, db);
  const cell = result.cells[0];
  assert.equal(cell.status, "REVIEW", "avisa, no bloquea");
  assert.ok(cell.messages.some((m) => m.code === "NO_SALE_PRICE"));
  assert.equal(cell.currentSalePrice, 0);
});

test("LA QUE IMPORTA — el margen se calcula sobre el costo RESULTANTE (entrado en esta línea), no sobre el costo efectivo viejo", async () => {
  const db = buildFakeDb({
    products: [{ id: "p1", standardSalePrice: 100, averageCost: 20 }], // costo viejo 20 -> margen viejo altísimo si se usara ese
    categoryPolicies: [{ branchId: BRANCH_1, categoryId: "cat-default", minMarginPercent: 30 }],
  });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: 10, unitCost: 85 }] }, db); // costo NUEVO 85 -> margen (100-85)/100=15%, bajo el 30%
  const cell = result.cells[0];
  const msg = cell.messages.find((m) => m.code === "MARGIN_BELOW_POLICY");
  assert.ok(msg, "debe avisar con el costo entrado, no el costo viejo (que hubiera dado margen de 80%)");
  assert.match(msg!.text, /15\.0%/);
});

test("precio bajo el costo resultante bloquea de punta a punta (vista previa real, no solo la validación pura)", async () => {
  const db = buildFakeDb({ products: [{ id: "p1", standardSalePrice: 100 }] });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "p1", quantity: 10, unitCost: 80, salePrice: 70 }] }, db);
  assert.equal(result.cells[0].status, "ERROR");
  assert.ok(result.cells[0].messages.some((m) => m.code === "PRICE_BELOW_COST"));
});

// ── "¿costo del paquete?" — misma regla que el guardado (wac.ts) ─────────

const FUSION_14 = [
  { productId: "varilla", stockGroupId: "g1", isCanonical: true, conversionFactor: 1, saleUnit: "UN" },
  { productId: "paquete", stockGroupId: "g1", isCanonical: false, conversionFactor: 14, saleUnit: "PAQ" },
];

test("primera entrada en la sucursal: costo por varilla mayor que el precio de la varilla EN ESA sucursal → aviso PACKAGE_COST_SUSPECTED (antes solo fallaba al guardar)", async () => {
  const db = buildFakeDb({
    products: [{ id: "varilla", standardSalePrice: 1 }, { id: "paquete", standardSalePrice: 5000 }],
    branchSettings: [{ branchId: BRANCH_1, productId: "varilla", branchPrice: 350 }],
    fusionMembers: FUSION_14,
  });
  // 14 paquetes tecleados como 1: C$68,600 por paquete = C$4,900 por varilla, contra 350.
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "paquete", quantity: 1, unitCost: 68600 }] }, db);
  assert.ok(result.cells[0].messages.some((m) => m.code === "PACKAGE_COST_SUSPECTED"));
  assert.equal(result.cells[0].status, "REVIEW", "es un aviso para revisar, no un error que impida guardar");
});

test("precio global de relleno (C$1) y sin precio de sucursal → no avisa: C$1 no es un precio real", async () => {
  const db = buildFakeDb({
    products: [{ id: "varilla", standardSalePrice: 1 }, { id: "paquete", standardSalePrice: 5000 }],
    fusionMembers: FUSION_14,
  });
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "paquete", quantity: 2, unitCost: 4200 }] }, db);
  assert.ok(!result.cells[0].messages.some((m) => m.code === "PACKAGE_COST_SUSPECTED"));
});

test("el precio nuevo que trae la misma entrada gana sobre el vigente: paquete a C$4,200 con precio nuevo C$4,900 (350/varilla) → no avisa", async () => {
  const db = buildFakeDb({
    products: [{ id: "varilla", standardSalePrice: 250 }, { id: "paquete", standardSalePrice: 3500 }],
    branchSettings: [{ branchId: BRANCH_1, productId: "varilla", branchPrice: 250 }],
    fusionMembers: FUSION_14,
  });
  // 4,200 / 14 = 300 por varilla: más que 250 (precio vigente), menos que 350 (el nuevo).
  const result = await previewIntake({ kind: "ADD_STOCK", branchIds: [BRANCH_1], lines: [{ productId: "paquete", quantity: 2, unitCost: 4200, salePrice: 4900 }] }, db);
  assert.ok(!result.cells[0].messages.some((m) => m.code === "PACKAGE_COST_SUSPECTED"));
});
