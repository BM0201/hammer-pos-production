import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * prompt-inventario-v3.md Fase 1.2 — lista de productos para la nueva
 * sección de Inventario, leyendo SOLO de ProductBranchState/
 * ProductCatalogState (nunca getEffectiveProductPricingBatch ni
 * InventoryBalance en vivo) — todo el filtro/orden pasa a la base.
 *
 * SQL crudo (no el query-builder de Prisma): `sort`/`view` dependen de
 * campos de ProductBranchState, que es una relación A-MUCHOS desde
 * Product (una fila por sucursal) — Prisma no permite ordenar por un
 * campo de una relación a-muchos filtrada por sucursal en tiempo de
 * ejecución (solo por _count). Un LEFT JOIN resuelve esto limpio y de
 * paso deja "sin fila todavía" (producto nunca tocado en esta sucursal)
 * caer a sus valores por defecto (0/null) sin un segundo camino de código.
 *
 * branchId es NECESARIO: todo lo que depende de sucursal (stock, costo,
 * precio, margen, estado, ventas 90d) no tiene sentido sin una — mismo
 * criterio que "sucursal de referencia para costo y precio, en la URL"
 * (Fase 3). NO_CODE/INACTIVE sí aplican sin sucursal real (ProductCatalogState
 * y Product.isActive son de red), pero para simplificar un solo contrato
 * esta función igual pide branchId siempre.
 */

export type InventoryProductView =
  | "ALL"
  | "NEGATIVE"
  | "LOW"
  | "ZERO"
  | "NO_COST"
  | "NO_PRICE"
  | "NO_CODE"
  | "NO_MOVEMENT_90D"
  | "COST_EQ_PRICE"
  | "INACTIVE";

export type InventoryProductSort = "name" | "stock" | "margin" | "value" | "sales90d" | "lastMovement";

export type InventoryProductRow = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  barcode: string | null;
  categoryId: string;
  categoryName: string;
  isActive: boolean;
  standardSalePrice: number;
  quantityOnHand: number;
  effectiveCost: number | null;
  effectivePrice: number | null;
  marginPercent: number | null;
  stockStatus: "NEGATIVE" | "ZERO" | "LOW" | "OK";
  lastMovementAt: Date | null;
  units90d: number;
  revenue90d: number;
  hasCode: boolean;
  hasCost: boolean;
  hasPrice: boolean;
  costEqualsPrice: boolean;
};

export type InventoryProductCounts = Record<InventoryProductView, number>;

export type ListInventoryProductsInput = {
  branchId: string;
  categoryId?: string;
  q?: string;
  view?: InventoryProductView;
  sort?: InventoryProductSort;
  cursor?: string;
  limit: number;
};

export type ListInventoryProductsResult = {
  rows: InventoryProductRow[];
  nextCursor: string | null;
  counts: InventoryProductCounts;
};

const SORT_EXPR: Record<InventoryProductSort, Prisma.Sql> = {
  name: Prisma.sql`p.name ASC, p.id ASC`,
  stock: Prisma.sql`COALESCE(pbs."quantityOnHand", 0) DESC, p.id ASC`,
  margin: Prisma.sql`pbs."marginPercent" DESC NULLS LAST, p.id ASC`,
  value: Prisma.sql`(COALESCE(pbs."quantityOnHand", 0) * COALESCE(pbs."effectiveCost", 0)) DESC, p.id ASC`,
  sales90d: Prisma.sql`COALESCE(pbs."units90d", 0) DESC, p.id ASC`,
  lastMovement: Prisma.sql`pbs."lastMovementAt" DESC NULLS LAST, p.id ASC`,
};

/**
 * `view IS NULL` cuenta como "ALL" — true cuando el producto queda bajo esa
 * vista. Usado tanto en el WHERE de la página como (sin el view activo) en
 * el FILTER de cada conteo.
 *
 * prompt-inventario-inicio-fix.md Commit 3 §3 — NO_COST/NO_PRICE/NO_CODE
 * antes contaban `pcs IS NULL` (el estado de ese producto TODAVÍA no se
 * calculó) igual que `pcs."hasCost" = false` (se calculó Y de verdad no
 * tiene costo) — "no sé" no es lo mismo que "no tiene", así que un producto
 * recién creado (antes de su primer refreshProductStateTx) salía contado
 * como "sin costo" sin que nadie lo haya revisado todavía. Ahora exige que
 * la fila EXISTA (`pcs."productId" IS NOT NULL`) antes de mirar el campo —
 * sin fila, no cuenta ni para un lado ni para el otro (la cobertura, no
 * este conteo, es quien dice "todavía falta calcular esto").
 */
const VIEW_COND: Record<Exclude<InventoryProductView, "ALL">, Prisma.Sql> = {
  NEGATIVE: Prisma.sql`pbs."stockStatus" = 'NEGATIVE'`,
  LOW: Prisma.sql`pbs."stockStatus" = 'LOW'`,
  ZERO: Prisma.sql`(pbs."stockStatus" = 'ZERO' OR pbs."productId" IS NULL)`,
  NO_COST: Prisma.sql`(pcs."productId" IS NOT NULL AND pcs."hasCost" = false)`,
  NO_PRICE: Prisma.sql`(pcs."productId" IS NOT NULL AND pcs."hasPrice" = false)`,
  NO_CODE: Prisma.sql`(pcs."productId" IS NOT NULL AND pcs."hasCode" = false)`,
  NO_MOVEMENT_90D: Prisma.sql`(pbs."lastMovementAt" IS NULL OR pbs."lastMovementAt" < now() - interval '90 days')`,
  COST_EQ_PRICE: Prisma.sql`pcs."costEqualsPrice" = true`,
  INACTIVE: Prisma.sql`p."isActive" = false`,
};

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export async function listInventoryProducts(input: ListInventoryProductsInput): Promise<ListInventoryProductsResult> {
  const view = input.view ?? "ALL";
  const offset = input.cursor ? Number(input.cursor) || 0 : 0;

  const baseConditions: Prisma.Sql[] = [
    // INACTIVE es la única vista que quiere ver productos desactivados — el resto parte de isActive=true, igual que hoy.
    view === "INACTIVE" ? Prisma.sql`p."isActive" = false` : Prisma.sql`p."isActive" = true`,
  ];
  if (input.categoryId) baseConditions.push(Prisma.sql`p."categoryId" = ${input.categoryId}`);
  if (input.q?.trim()) {
    const q = input.q.trim();
    baseConditions.push(Prisma.sql`(p.name ILIKE ${"%" + q + "%"} OR p.sku ILIKE ${"%" + q + "%"} OR p.barcode = ${q})`);
  }
  const baseWhere = Prisma.join(baseConditions, " AND ");

  const viewCondition = view !== "ALL" && view !== "INACTIVE" ? Prisma.sql`AND ${VIEW_COND[view]}` : Prisma.sql``;
  const sortExpr = SORT_EXPR[input.sort ?? "name"];

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      p.id, p.sku, p.name, p.unit, p.barcode, p."categoryId", c.name AS "categoryName", p."isActive",
      p."standardSalePrice",
      COALESCE(pbs."quantityOnHand", 0) AS "quantityOnHand",
      pbs."effectiveCost", pbs."effectivePrice", pbs."marginPercent",
      COALESCE(pbs."stockStatus"::text, 'ZERO') AS "stockStatus",
      pbs."lastMovementAt",
      COALESCE(pbs."units90d", 0) AS "units90d",
      COALESCE(pbs."revenue90d", 0) AS "revenue90d",
      COALESCE(pcs."hasCode", false) AS "hasCode",
      COALESCE(pcs."hasCost", false) AS "hasCost",
      COALESCE(pcs."hasPrice", false) AS "hasPrice",
      COALESCE(pcs."costEqualsPrice", false) AS "costEqualsPrice"
    FROM "Product" p
    JOIN "Category" c ON c.id = p."categoryId"
    LEFT JOIN "ProductBranchState" pbs ON pbs."productId" = p.id AND pbs."branchId" = ${input.branchId}
    LEFT JOIN "ProductCatalogState" pcs ON pcs."productId" = p.id
    WHERE ${baseWhere} ${viewCondition}
    ORDER BY ${sortExpr}
    LIMIT ${input.limit + 1}
    OFFSET ${offset}
  `;

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const nextCursor = hasMore ? String(offset + input.limit) : null;

  const mapped: InventoryProductRow[] = page.map((r) => ({
    id: r.id as string,
    sku: r.sku as string,
    name: r.name as string,
    unit: r.unit as string,
    barcode: r.barcode as string | null,
    categoryId: r.categoryId as string,
    categoryName: r.categoryName as string,
    isActive: r.isActive as boolean,
    standardSalePrice: decimalToNumber(r.standardSalePrice as Prisma.Decimal),
    quantityOnHand: decimalToNumber(r.quantityOnHand as Prisma.Decimal),
    effectiveCost: r.effectiveCost !== null ? decimalToNumber(r.effectiveCost as Prisma.Decimal) : null,
    effectivePrice: r.effectivePrice !== null ? decimalToNumber(r.effectivePrice as Prisma.Decimal) : null,
    marginPercent: r.marginPercent !== null ? decimalToNumber(r.marginPercent as Prisma.Decimal) : null,
    stockStatus: r.stockStatus as InventoryProductRow["stockStatus"],
    lastMovementAt: r.lastMovementAt as Date | null,
    units90d: decimalToNumber(r.units90d as Prisma.Decimal),
    revenue90d: decimalToNumber(r.revenue90d as Prisma.Decimal),
    hasCode: r.hasCode as boolean,
    hasCost: r.hasCost as boolean,
    hasPrice: r.hasPrice as boolean,
    costEqualsPrice: r.costEqualsPrice as boolean,
  }));

  const counts = await countInventoryProductsByView(input);

  return { rows: mapped, nextCursor, counts };
}

/**
 * Conteos por vista (los chips) con UNA sola consulta agrupada — misma
 * base (categoría/texto), SIN el filtro de vista activo, para que cada
 * chip muestre cuántos HABRÍA en esa vista sin tener que recorrer la
 * tabla una vez por chip.
 */
async function countInventoryProductsByView(input: Pick<ListInventoryProductsInput, "branchId" | "categoryId" | "q">): Promise<InventoryProductCounts> {
  const conditions: Prisma.Sql[] = [];
  if (input.categoryId) conditions.push(Prisma.sql`p."categoryId" = ${input.categoryId}`);
  if (input.q?.trim()) {
    const q = input.q.trim();
    conditions.push(Prisma.sql`(p.name ILIKE ${"%" + q + "%"} OR p.sku ILIKE ${"%" + q + "%"} OR p.barcode = ${q})`);
  }
  const extraWhere = conditions.length > 0 ? Prisma.sql`AND ${Prisma.join(conditions, " AND ")}` : Prisma.sql``;

  const [row] = await prisma.$queryRaw<Array<Record<string, bigint>>>`
    SELECT
      COUNT(*) FILTER (WHERE p."isActive" = true) AS "ALL",
      COUNT(*) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.NEGATIVE}) AS "NEGATIVE",
      COUNT(*) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.LOW}) AS "LOW",
      COUNT(*) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.ZERO}) AS "ZERO",
      COUNT(*) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.NO_COST}) AS "NO_COST",
      COUNT(*) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.NO_PRICE}) AS "NO_PRICE",
      COUNT(*) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.NO_CODE}) AS "NO_CODE",
      COUNT(*) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.NO_MOVEMENT_90D}) AS "NO_MOVEMENT_90D",
      COUNT(*) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.COST_EQ_PRICE}) AS "COST_EQ_PRICE",
      COUNT(*) FILTER (WHERE p."isActive" = false) AS "INACTIVE"
    FROM "Product" p
    LEFT JOIN "ProductBranchState" pbs ON pbs."productId" = p.id AND pbs."branchId" = ${input.branchId}
    LEFT JOIN "ProductCatalogState" pcs ON pcs."productId" = p.id
    WHERE true ${extraWhere}
  `;

  return {
    ALL: Number(row.ALL),
    NEGATIVE: Number(row.NEGATIVE),
    LOW: Number(row.LOW),
    ZERO: Number(row.ZERO),
    NO_COST: Number(row.NO_COST),
    NO_PRICE: Number(row.NO_PRICE),
    NO_CODE: Number(row.NO_CODE),
    NO_MOVEMENT_90D: Number(row.NO_MOVEMENT_90D),
    COST_EQ_PRICE: Number(row.COST_EQ_PRICE),
    INACTIVE: Number(row.INACTIVE),
  };
}

/**
 * Fase 1.2 — overview: KPIs de red/sucursal desde ProductBranchState (nunca
 * recalculados en vivo). "Para atender" (la lista accionable) es Fase 2 —
 * acá solo los números agregados.
 */
export type InventoryOverview = {
  /** null = "Toda la red" (agregado de todas las sucursales, no una en particular). */
  branchId: string | null;
  totalValueAtCost: number;
  activeProducts: number;
  /** prompt-inventario-inicio-fix.md Commit 2 §1 — sub-línea de "Productos activos" ("12 creados este mes"). */
  createdThisMonth: number;
  negativeStock: number;
  lowStock: number;
  noCostOrPrice: number;
  /** Commit 2 §1 — sub-línea de "Sin movimiento 90 días" ("C$18,420 en 31 con costo · 147 sin costo"): cuántos del total tienen costo (contribuyen al value) vs no. */
  noMovement90d: { count: number; value: number; withCost: number };
  /** Commit 3 §3 — ProductBranchState: pares (producto activo, sucursal activa) con estado YA calculado, de los que deberían tenerlo. branchId concreto → expected=activeProducts; red → expected=activeProducts×sucursales activas. */
  coverage: StateCoverage;
};

/**
 * branchId null — "Toda la red" (prompt-inventario-inicio-fix.md §1.1/1.3):
 * activeProducts/noCostOrPrice ya eran de red (ProductCatalogState no tiene
 * sucursal), pero negativeStock/lowStock/noMovement90d SÍ dependían de una
 * sola fila de ProductBranchState por producto — agregarlos de verdad
 * requiere explotar el producto en una fila por sucursal (CTE) en vez de
 * filtrar a una. "Negativo"/"Por agotarse" de red = con que UNA sucursal lo
 * tenga ya cuenta (OR); "sin movimiento 90d" de red = que NINGUNA sucursal
 * lo haya movido (AND) — lo contrario (OR) marcaría como "muerto" un
 * producto que sí se vende, solo que en otra sucursal.
 */
export async function getInventoryOverview(branchId: string | null): Promise<InventoryOverview> {
  if (branchId === null) return getInventoryOverviewNetwork();

  const [row, coverage] = await Promise.all([
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        COALESCE(SUM(COALESCE(pbs."quantityOnHand", 0) * COALESCE(pbs."effectiveCost", 0)), 0) AS "totalValueAtCost",
        COUNT(*) FILTER (WHERE p."isActive" = true) AS "activeProducts",
        COUNT(*) FILTER (WHERE p."isActive" = true AND p."createdAt" >= date_trunc('month', now())) AS "createdThisMonth",
        COUNT(*) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.NEGATIVE}) AS "negativeStock",
        COUNT(*) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.LOW}) AS "lowStock",
        COUNT(*) FILTER (WHERE p."isActive" = true AND (${VIEW_COND.NO_COST} OR ${VIEW_COND.NO_PRICE})) AS "noCostOrPrice",
        COUNT(*) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.NO_MOVEMENT_90D}) AS "noMovement90dCount",
        COUNT(*) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.NO_MOVEMENT_90D} AND COALESCE(pcs."hasCost", false) = true) AS "noMovement90dWithCost",
        COALESCE(SUM(COALESCE(pbs."quantityOnHand", 0) * COALESCE(pbs."effectiveCost", 0)) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.NO_MOVEMENT_90D}), 0) AS "noMovement90dValue"
      FROM "Product" p
      LEFT JOIN "ProductBranchState" pbs ON pbs."productId" = p.id AND pbs."branchId" = ${branchId}
      LEFT JOIN "ProductCatalogState" pcs ON pcs."productId" = p.id
    `.then((rows) => rows[0]),
    getProductBranchStateCoverage(branchId),
  ]);

  return {
    branchId,
    totalValueAtCost: decimalToNumber(row.totalValueAtCost as Prisma.Decimal),
    activeProducts: Number(row.activeProducts),
    createdThisMonth: Number(row.createdThisMonth),
    negativeStock: Number(row.negativeStock),
    lowStock: Number(row.lowStock),
    noCostOrPrice: Number(row.noCostOrPrice),
    noMovement90d: {
      count: Number(row.noMovement90dCount),
      value: decimalToNumber(row.noMovement90dValue as Prisma.Decimal),
      withCost: Number(row.noMovement90dWithCost),
    },
    coverage,
  };
}

/**
 * prompt-inventario-inicio-fix.md Commit 3 §3 — "expected" NUNCA es
 * "todo producto activo × toda sucursal activa": no todos los productos
 * existen en todas las sucursales (visibilidad por sucursal,
 * BranchProductSetting.isAvailable) y contarlo así marca permanentemente
 * cobertura incompleta en productos que simplemente nunca estuvieron en
 * esa sucursal — ni es un hueco, ni algo que un backfill vaya a llenar
 * jamás. "Expected" real = pares con ALGUNA señal de que el producto
 * existe ahí (InventoryBalance, BranchProductSetting o StockReorderPolicy)
 * — el mismo criterio que ya usa discoverRelevantPairs (product-state-
 * service.ts) para decidir qué refrescar.
 */
async function getProductBranchStateCoverage(branchId: string): Promise<StateCoverage> {
  const [row] = await prisma.$queryRaw<Array<{ expected: bigint; present: bigint }>>`
    WITH signals AS (
      SELECT DISTINCT "productId" FROM "InventoryBalance" WHERE "branchId" = ${branchId}
      UNION
      SELECT DISTINCT "productId" FROM "BranchProductSetting" WHERE "branchId" = ${branchId}
      UNION
      SELECT DISTINCT "productId" FROM "StockReorderPolicy" WHERE "branchId" = ${branchId}
    )
    SELECT
      COUNT(*) AS expected,
      COUNT(*) FILTER (WHERE pbs."productId" IS NOT NULL) AS present
    FROM signals s
    JOIN "Product" p ON p.id = s."productId" AND p."isActive" = true
    LEFT JOIN "ProductBranchState" pbs ON pbs."productId" = s."productId" AND pbs."branchId" = ${branchId}
  `;
  return { expected: Number(row.expected), present: Number(row.present) };
}

async function getProductBranchStateCoverageNetwork(): Promise<StateCoverage> {
  const [row] = await prisma.$queryRaw<Array<{ expected: bigint; present: bigint }>>`
    WITH signals AS (
      SELECT DISTINCT "productId", "branchId" FROM "InventoryBalance"
      UNION
      SELECT DISTINCT "productId", "branchId" FROM "BranchProductSetting"
      UNION
      SELECT DISTINCT "productId", "branchId" FROM "StockReorderPolicy"
    )
    SELECT
      COUNT(*) AS expected,
      COUNT(*) FILTER (WHERE pbs."productId" IS NOT NULL) AS present
    FROM signals s
    JOIN "Product" p ON p.id = s."productId" AND p."isActive" = true
    JOIN "Branch" b ON b.id = s."branchId" AND b."isActive" = true
    LEFT JOIN "ProductBranchState" pbs ON pbs."productId" = s."productId" AND pbs."branchId" = s."branchId"
  `;
  return { expected: Number(row.expected), present: Number(row.present) };
}

async function getInventoryOverviewNetwork(): Promise<InventoryOverview> {
  const [[row], coverage] = await Promise.all([
    prisma.$queryRaw<Array<Record<string, unknown>>>`
    WITH agg AS (
      SELECT
        p.id AS "productId",
        p."isActive",
        p."createdAt",
        -- Commit 3 §3 — igual cuidado que VIEW_COND/getInventoryQualityCounts:
        -- "hasCatalogState" distingue "no tiene costo" de "todavía no se
        -- calculó su estado" (pcs ausente).
        (pcs."productId" IS NOT NULL) AS "hasCatalogState",
        COALESCE(pcs."hasCost", false) AS "hasCost",
        COALESCE(pcs."hasPrice", false) AS "hasPrice",
        SUM(COALESCE(pbs."quantityOnHand", 0) * COALESCE(pbs."effectiveCost", 0)) AS value,
        BOOL_OR(pbs."stockStatus" = 'NEGATIVE') AS "isNegative",
        BOOL_OR(pbs."stockStatus" = 'LOW') AS "isLow",
        BOOL_AND(pbs."lastMovementAt" IS NULL OR pbs."lastMovementAt" < now() - interval '90 days') AS "isNoMovement"
      FROM "Product" p
      LEFT JOIN "ProductBranchState" pbs ON pbs."productId" = p.id
      LEFT JOIN "ProductCatalogState" pcs ON pcs."productId" = p.id
      GROUP BY p.id, p."isActive", p."createdAt", pcs."productId", pcs."hasCost", pcs."hasPrice"
    )
    SELECT
      COALESCE(SUM(value), 0) AS "totalValueAtCost",
      COUNT(*) FILTER (WHERE "isActive") AS "activeProducts",
      COUNT(*) FILTER (WHERE "isActive" AND "createdAt" >= date_trunc('month', now())) AS "createdThisMonth",
      COUNT(*) FILTER (WHERE "isActive" AND "isNegative") AS "negativeStock",
      COUNT(*) FILTER (WHERE "isActive" AND "isLow") AS "lowStock",
      COUNT(*) FILTER (WHERE "isActive" AND "hasCatalogState" AND (NOT "hasCost" OR NOT "hasPrice")) AS "noCostOrPrice",
      COUNT(*) FILTER (WHERE "isActive" AND "isNoMovement") AS "noMovement90dCount",
      COUNT(*) FILTER (WHERE "isActive" AND "isNoMovement" AND "hasCost") AS "noMovement90dWithCost",
      COALESCE(SUM(value) FILTER (WHERE "isActive" AND "isNoMovement"), 0) AS "noMovement90dValue"
    FROM agg
  `,
    getProductBranchStateCoverageNetwork(),
  ]);

  return {
    branchId: null,
    totalValueAtCost: decimalToNumber(row.totalValueAtCost as Prisma.Decimal),
    activeProducts: Number(row.activeProducts),
    createdThisMonth: Number(row.createdThisMonth),
    negativeStock: Number(row.negativeStock),
    lowStock: Number(row.lowStock),
    noCostOrPrice: Number(row.noCostOrPrice),
    noMovement90d: {
      count: Number(row.noMovement90dCount),
      value: decimalToNumber(row.noMovement90dValue as Prisma.Decimal),
      withCost: Number(row.noMovement90dWithCost),
    },
    coverage,
  };
}

export type InventoryStockMatrixRow = {
  productId: string;
  sku: string;
  name: string;
  branches: Array<{ branchId: string; branchCode: string; quantityOnHand: number; stockStatus: InventoryProductRow["stockStatus"] }>;
};

/** Fase 1.2 — matriz producto × sucursal, solo de ProductBranchState (sin recalcular nada). */
export async function getInventoryStockMatrix(input: { branchIds: string[]; categoryId?: string; q?: string }): Promise<InventoryStockMatrixRow[]> {
  const conditions: Prisma.Sql[] = [Prisma.sql`p."isActive" = true`];
  if (input.categoryId) conditions.push(Prisma.sql`p."categoryId" = ${input.categoryId}`);
  if (input.q?.trim()) {
    const q = input.q.trim();
    conditions.push(Prisma.sql`(p.name ILIKE ${"%" + q + "%"} OR p.sku ILIKE ${"%" + q + "%"})`);
  }
  const where = Prisma.join(conditions, " AND ");

  const rows = await prisma.$queryRaw<Array<{ productId: string; sku: string; name: string; branchId: string; branchCode: string; quantityOnHand: Prisma.Decimal; stockStatus: string | null }>>`
    SELECT p.id AS "productId", p.sku, p.name, b.id AS "branchId", b.code AS "branchCode",
      COALESCE(pbs."quantityOnHand", 0) AS "quantityOnHand",
      COALESCE(pbs."stockStatus"::text, 'ZERO') AS "stockStatus"
    FROM "Product" p
    CROSS JOIN "Branch" b
    LEFT JOIN "ProductBranchState" pbs ON pbs."productId" = p.id AND pbs."branchId" = b.id
    WHERE ${where} AND b.id IN (${Prisma.join(input.branchIds)}) AND b."isActive" = true
    ORDER BY p.name ASC, b.code ASC
  `;

  const byProduct = new Map<string, InventoryStockMatrixRow>();
  for (const row of rows) {
    const existing = byProduct.get(row.productId);
    const branchEntry = { branchId: row.branchId, branchCode: row.branchCode, quantityOnHand: decimalToNumber(row.quantityOnHand), stockStatus: row.stockStatus as InventoryProductRow["stockStatus"] };
    if (existing) existing.branches.push(branchEntry);
    else byProduct.set(row.productId, { productId: row.productId, sku: row.sku, name: row.name, branches: [branchEntry] });
  }
  return [...byProduct.values()];
}

/** Fase 1.2 — kardex global paginado por cursor (reemplaza el take:200 fijo de getCatalogInventoryCenter). */
export async function listInventoryMovements(input: { branchId?: string; productId?: string; cursor?: string; limit: number }) {
  const where: Prisma.InventoryMovementWhereInput = {
    ...(input.branchId ? { branchId: input.branchId } : {}),
    ...(input.productId ? { productId: input.productId } : {}),
  };
  const movements = await prisma.inventoryMovement.findMany({
    where,
    include: {
      branch: { select: { id: true, code: true, name: true } },
      product: { select: { id: true, sku: true, name: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const hasMore = movements.length > input.limit;
  const page = hasMore ? movements.slice(0, input.limit) : movements;
  return { movements: page, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null };
}

export type InventoryCategoryNode = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
  productCount: number;
  valueAtCost: number;
  children: InventoryCategoryNode[];
};

/** Fase 1.2 — árbol de categorías con conteos (productos activos + valor a costo de la sucursal pedida). */
export async function getInventoryCategoriesTree(branchId: string): Promise<InventoryCategoryNode[]> {
  const categories = await prisma.category.findMany({ select: { id: true, code: true, name: true, parentId: true, isActive: true }, orderBy: { name: "asc" } });
  const counts = await prisma.$queryRaw<Array<{ categoryId: string; productCount: bigint; valueAtCost: Prisma.Decimal }>>`
    SELECT p."categoryId", COUNT(*) AS "productCount",
      COALESCE(SUM(COALESCE(pbs."quantityOnHand", 0) * COALESCE(pbs."effectiveCost", 0)), 0) AS "valueAtCost"
    FROM "Product" p
    LEFT JOIN "ProductBranchState" pbs ON pbs."productId" = p.id AND pbs."branchId" = ${branchId}
    WHERE p."isActive" = true
    GROUP BY p."categoryId"
  `;
  const countByCategory = new Map(counts.map((c) => [c.categoryId, { productCount: Number(c.productCount), valueAtCost: decimalToNumber(c.valueAtCost) }]));

  const nodeById = new Map<string, InventoryCategoryNode>();
  for (const cat of categories) {
    const agg = countByCategory.get(cat.id) ?? { productCount: 0, valueAtCost: 0 };
    nodeById.set(cat.id, { ...cat, ...agg, children: [] });
  }
  const roots: InventoryCategoryNode[] = [];
  for (const node of nodeById.values()) {
    if (node.parentId && nodeById.has(node.parentId)) nodeById.get(node.parentId)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

const DAILY_FLOW_IN_TYPES = ["PURCHASE_IN", "RETURN_IN", "RETURN_IN_DAMAGED", "ADJUSTMENT_IN", "TRANSFER_IN", "PACKAGE_IN", "LOOSE_UNIT_RETURN_IN", "TIMBER_INTAKE_IN"] as const;
const DAILY_FLOW_OUT_TYPES = ["SALE_OUT", "RETURN_OUT", "ADJUSTMENT_OUT", "TRANSFER_OUT", "PACKAGE_SALE_OUT", "LOOSE_UNIT_SALE_OUT"] as const;

export type InventoryDailyFlowPoint = { date: string; unitsIn: number; unitsOut: number };

/**
 * Fase 2.2 — "entradas y salidas de los últimos 30 días" (barras por día).
 * Deliberadamente deja afuera lo que es reempaque interno, no flujo real
 * (PACKAGE_OPENED/_AUTO_OPENED/_CLOSED, LOOSE_ADJUSTMENT,
 * PACKAGE_ADJUSTMENT) y el consumo de producción (ni "entra" ni "sale" de
 * la red, se transforma) — contarlos infla el gráfico con movimientos que
 * no representan mercadería entrando o saliendo de verdad.
 *
 * prompt-inventario-inicio-fix.md Commit 3 §4 — agrupaba por día en UTC
 * (`date_trunc('day', "createdAt")`), corriendo el día real en Managua
 * (UTC-6): un movimiento de las 6pm en Managua ya cae del lado de "mañana"
 * en UTC. Mismo idiom ya usado en reports/sales-analytics.ts para
 * "paidAt" por día de Managua — `AT TIME ZONE 'UTC' AT TIME ZONE
 * 'America/Managua'` reinterpreta el instante en hora local antes de
 * truncar. `quantity` siempre es la MAGNITUD positiva (la dirección la da
 * `movementType`, nunca el signo — verificado contra producción: ventas de
 * 30 días con SUM(quantity) > 0 en los dos únicos branches con actividad),
 * así que sumar directo a unitsIn/unitsOut ya era correcto — no había bug
 * de signo, solo el de huso horario.
 */
export async function getInventoryDailyFlow(branchId: string, days = 30): Promise<InventoryDailyFlowPoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<Array<{ day: string; movementType: string; total: Prisma.Decimal }>>`
    SELECT ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Managua')::date::text AS day, "movementType", SUM(quantity) AS total
    FROM "InventoryMovement"
    WHERE "branchId" = ${branchId} AND "createdAt" >= ${since}
      AND "movementType"::text IN (${Prisma.join([...DAILY_FLOW_IN_TYPES, ...DAILY_FLOW_OUT_TYPES])})
    GROUP BY 1, "movementType"
  `;

  const byDay = new Map<string, InventoryDailyFlowPoint>();
  for (const row of rows) {
    const key = row.day;
    const point = byDay.get(key) ?? { date: key, unitsIn: 0, unitsOut: 0 };
    if ((DAILY_FLOW_IN_TYPES as readonly string[]).includes(row.movementType)) point.unitsIn += decimalToNumber(row.total);
    else point.unitsOut += decimalToNumber(row.total);
    byDay.set(key, point);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * prompt-inventario-inicio-fix.md Commit 1 — conteos para los 4 grupos de
 * la barra superior (Catálogo/Existencias/Calidad de datos), en una sola
 * consulta por concepto en vez de que el topbar dispare 3-4 pedidos.
 * "Traslados atrasados" = IN_TRANSIT/PARTIALLY_RECEIVED despachados hace
 * más de 2 días — no existía ningún conteo de esto en el sistema todavía.
 */
export type InventoryNavCounts = { activeProducts: number; negativeStock: number; lowStock: number; staleTransfers: number; pendingQuality: number };

export async function getInventoryNavCounts(branchId: string | null): Promise<InventoryNavCounts> {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const [overview, quality, staleTransfers] = await Promise.all([
    getInventoryOverview(branchId),
    getInventoryQualityCounts(),
    prisma.transfer.count({ where: { status: { in: ["IN_TRANSIT", "PARTIALLY_RECEIVED"] }, dispatchedAt: { lt: twoDaysAgo } } }),
  ]);
  const pendingQuality = quality.noCost + quality.noPrice + quality.noCode + quality.costEqualsPrice + quality.noCategory;
  return { activeProducts: overview.activeProducts, negativeStock: overview.negativeStock, lowStock: overview.lowStock, staleTransfers, pendingQuality };
}

export type StateCoverage = { expected: number; present: number };

export type InventoryQualityCounts = {
  noCost: number;
  noPrice: number;
  noCode: number;
  costEqualsPrice: number;
  noCategory: number;
  /** Commit 2 §5 — "2,336 pendientes en 1,190 productos": productos DISTINTOS con al menos uno de los 5 problemas (un producto puede tener varios a la vez, por eso nunca es la suma). */
  affectedProducts: number;
  /** Commit 3 §3 — ProductCatalogState: cuántos productos activos YA tienen su estado calculado, de los que deberían tenerlo. */
  coverage: StateCoverage;
};

/**
 * Fase 1.2 — conteos de calidad del catálogo (la versión completa, con
 * detectores de duplicados/unidades/nombres, es Fase 5).
 *
 * Commit 3 §3 — noCost/noPrice/noCode exigen que la fila de
 * ProductCatalogState EXISTA (`pcs."productId" IS NOT NULL`) antes de
 * mirar el campo, igual que VIEW_COND arriba — un producto sin estado
 * calculado todavía no es "sin costo", es "no sé". `affectedProducts`
 * hereda el mismo cuidado.
 */
export async function getInventoryQualityCounts(): Promise<InventoryQualityCounts> {
  const [row] = await prisma.$queryRaw<Array<Record<string, bigint>>>`
    SELECT
      COUNT(*) FILTER (WHERE p."isActive" = true AND pcs."productId" IS NOT NULL AND pcs."hasCost" = false) AS "noCost",
      COUNT(*) FILTER (WHERE p."isActive" = true AND pcs."productId" IS NOT NULL AND pcs."hasPrice" = false) AS "noPrice",
      COUNT(*) FILTER (WHERE p."isActive" = true AND pcs."productId" IS NOT NULL AND pcs."hasCode" = false) AS "noCode",
      COUNT(*) FILTER (WHERE p."isActive" = true AND pcs."costEqualsPrice" = true) AS "costEqualsPrice",
      -- "Sin categoría" no existe de verdad (categoryId es obligatorio en el
      -- schema) — lo único detectable es "en una categoría genérica tipo
      -- cajón de sastre", por NOMBRE (no hay ningún código reservado para
      -- eso en el sistema). Heurística honesta, no una regla de negocio.
      COUNT(*) FILTER (WHERE p."isActive" = true AND c.name ILIKE '%general%') AS "noCategory",
      COUNT(*) FILTER (WHERE p."isActive" = true AND (
        (pcs."productId" IS NOT NULL AND pcs."hasCost" = false) OR
        (pcs."productId" IS NOT NULL AND pcs."hasPrice" = false) OR
        (pcs."productId" IS NOT NULL AND pcs."hasCode" = false) OR
        pcs."costEqualsPrice" = true OR
        c.name ILIKE '%general%'
      )) AS "affectedProducts",
      COUNT(*) FILTER (WHERE p."isActive" = true) AS "coverageExpected",
      COUNT(*) FILTER (WHERE p."isActive" = true AND pcs."productId" IS NOT NULL) AS "coveragePresent"
    FROM "Product" p
    JOIN "Category" c ON c.id = p."categoryId"
    LEFT JOIN "ProductCatalogState" pcs ON pcs."productId" = p.id
  `;
  return {
    noCost: Number(row.noCost),
    noPrice: Number(row.noPrice),
    noCode: Number(row.noCode),
    costEqualsPrice: Number(row.costEqualsPrice),
    noCategory: Number(row.noCategory),
    affectedProducts: Number(row.affectedProducts),
    coverage: { expected: Number(row.coverageExpected), present: Number(row.coveragePresent) },
  };
}

export type InventoryAttentionCounts = {
  noCost: number;
  noPrice: number;
  costEqualsPrice: number;
  negativeStock: number;
  lowStock: number;
  staleTransfers: number;
  staleTransferSample: { transferNumber: string; fromBranchCode: string; toBranchCode: string } | null;
  failedIntakeLines: number;
  /**
   * De los 20 productos que más venden (units90d, SOLO tiene sentido por
   * sucursal), cuántos no tienen costo — "Los 20 que más venden primero"
   * (Commit 2 §4). null en "Toda la red": units90d vive por sucursal en
   * ProductBranchState y agregarlo en red es un cálculo distinto, fuera de
   * lo que este commit pide — la fila cae a su texto genérico.
   */
  topMoversNoCost: number | null;
};

const STALE_TRANSFER_STATUSES = ["IN_TRANSIT", "PARTIALLY_RECEIVED"] as const;

/**
 * prompt-inventario-inicio-fix.md Commit 2 §4 — conteos crudos para las
 * filas de "Para atender" (7 de los 8 tipos del doc; "conteos por aprobar"
 * no tiene ninguna entidad real detrás todavía — ni modelo, ni workflow de
 * aprobación — así que no se inventa acá: la fila simplemente no sale
 * nunca mientras no exista esa pieza). Etiquetas/orden/enlaces se arman en
 * el frontend (inventory-home-logic.ts) a partir de estos números — acá
 * solo los datos.
 */
export async function getInventoryAttentionCounts(branchId: string | null): Promise<InventoryAttentionCounts> {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const [overview, quality, staleTransfers, staleTransferSampleRows, failedIntakeLines, topMoversNoCost] = await Promise.all([
    getInventoryOverview(branchId),
    getInventoryQualityCounts(),
    prisma.transfer.count({ where: { status: { in: [...STALE_TRANSFER_STATUSES] }, dispatchedAt: { lt: twoDaysAgo } } }),
    prisma.transfer.findMany({
      where: { status: { in: [...STALE_TRANSFER_STATUSES] }, dispatchedAt: { lt: twoDaysAgo } },
      select: { transferNumber: true, fromBranch: { select: { code: true } }, toBranch: { select: { code: true } } },
      orderBy: { dispatchedAt: "asc" },
      take: 1,
    }),
    prisma.multiBranchIntakeBranch.count({ where: { status: "FAILED" } }),
    branchId ? getTopMoversNoCostCount(branchId) : Promise.resolve(null),
  ]);

  const sample = staleTransferSampleRows[0];
  return {
    noCost: quality.noCost,
    noPrice: quality.noPrice,
    costEqualsPrice: quality.costEqualsPrice,
    negativeStock: overview.negativeStock,
    lowStock: overview.lowStock,
    staleTransfers,
    staleTransferSample: sample ? { transferNumber: sample.transferNumber, fromBranchCode: sample.fromBranch.code, toBranchCode: sample.toBranch.code } : null,
    failedIntakeLines,
    topMoversNoCost,
  };
}

async function getTopMoversNoCostCount(branchId: string, topN = 20): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ hasCost: boolean }>>`
    SELECT COALESCE(pcs."hasCost", false) AS "hasCost"
    FROM "Product" p
    LEFT JOIN "ProductBranchState" pbs ON pbs."productId" = p.id AND pbs."branchId" = ${branchId}
    LEFT JOIN "ProductCatalogState" pcs ON pcs."productId" = p.id
    WHERE p."isActive" = true
    ORDER BY COALESCE(pbs."units90d", 0) DESC
    LIMIT ${topN}
  `;
  return rows.filter((r) => !r.hasCost).length;
}
