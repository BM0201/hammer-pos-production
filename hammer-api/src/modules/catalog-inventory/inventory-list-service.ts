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

/** `view IS NULL` cuenta como "ALL" — true cuando el producto queda bajo esa vista. Usado tanto en el WHERE de la página como (sin el view activo) en el FILTER de cada conteo. */
const VIEW_COND: Record<Exclude<InventoryProductView, "ALL">, Prisma.Sql> = {
  NEGATIVE: Prisma.sql`pbs."stockStatus" = 'NEGATIVE'`,
  LOW: Prisma.sql`pbs."stockStatus" = 'LOW'`,
  ZERO: Prisma.sql`(pbs."stockStatus" = 'ZERO' OR pbs."productId" IS NULL)`,
  NO_COST: Prisma.sql`(pcs."hasCost" IS NULL OR pcs."hasCost" = false)`,
  NO_PRICE: Prisma.sql`(pcs."hasPrice" IS NULL OR pcs."hasPrice" = false)`,
  NO_CODE: Prisma.sql`(pcs."hasCode" IS NULL OR pcs."hasCode" = false)`,
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
  branchId: string;
  totalValueAtCost: number;
  activeProducts: number;
  negativeStock: number;
  lowStock: number;
  noCostOrPrice: number;
  noMovement90d: { count: number; value: number };
};

export async function getInventoryOverview(branchId: string): Promise<InventoryOverview> {
  const [row] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      COALESCE(SUM(COALESCE(pbs."quantityOnHand", 0) * COALESCE(pbs."effectiveCost", 0)), 0) AS "totalValueAtCost",
      COUNT(*) FILTER (WHERE p."isActive" = true) AS "activeProducts",
      COUNT(*) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.NEGATIVE}) AS "negativeStock",
      COUNT(*) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.LOW}) AS "lowStock",
      COUNT(*) FILTER (WHERE p."isActive" = true AND (${VIEW_COND.NO_COST} OR ${VIEW_COND.NO_PRICE})) AS "noCostOrPrice",
      COUNT(*) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.NO_MOVEMENT_90D}) AS "noMovement90dCount",
      COALESCE(SUM(COALESCE(pbs."quantityOnHand", 0) * COALESCE(pbs."effectiveCost", 0)) FILTER (WHERE p."isActive" = true AND ${VIEW_COND.NO_MOVEMENT_90D}), 0) AS "noMovement90dValue"
    FROM "Product" p
    LEFT JOIN "ProductBranchState" pbs ON pbs."productId" = p.id AND pbs."branchId" = ${branchId}
    LEFT JOIN "ProductCatalogState" pcs ON pcs."productId" = p.id
  `;

  return {
    branchId,
    totalValueAtCost: decimalToNumber(row.totalValueAtCost as Prisma.Decimal),
    activeProducts: Number(row.activeProducts),
    negativeStock: Number(row.negativeStock),
    lowStock: Number(row.lowStock),
    noCostOrPrice: Number(row.noCostOrPrice),
    noMovement90d: { count: Number(row.noMovement90dCount), value: decimalToNumber(row.noMovement90dValue as Prisma.Decimal) },
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
 */
export async function getInventoryDailyFlow(branchId: string, days = 30): Promise<InventoryDailyFlowPoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<Array<{ day: Date; movementType: string; total: Prisma.Decimal }>>`
    SELECT date_trunc('day', "createdAt") AS day, "movementType", SUM(quantity) AS total
    FROM "InventoryMovement"
    WHERE "branchId" = ${branchId} AND "createdAt" >= ${since}
      AND "movementType"::text IN (${Prisma.join([...DAILY_FLOW_IN_TYPES, ...DAILY_FLOW_OUT_TYPES])})
    GROUP BY day, "movementType"
  `;

  const byDay = new Map<string, InventoryDailyFlowPoint>();
  for (const row of rows) {
    const key = row.day.toISOString().slice(0, 10);
    const point = byDay.get(key) ?? { date: key, unitsIn: 0, unitsOut: 0 };
    if ((DAILY_FLOW_IN_TYPES as readonly string[]).includes(row.movementType)) point.unitsIn += decimalToNumber(row.total);
    else point.unitsOut += decimalToNumber(row.total);
    byDay.set(key, point);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export type InventoryQualityCounts = {
  noCost: number;
  noPrice: number;
  noCode: number;
  costEqualsPrice: number;
  noCategory: number;
};

/** Fase 1.2 — conteos de calidad del catálogo (la versión completa, con detectores de duplicados/unidades/nombres, es Fase 5). */
export async function getInventoryQualityCounts(): Promise<InventoryQualityCounts> {
  const [row] = await prisma.$queryRaw<Array<Record<string, bigint>>>`
    SELECT
      COUNT(*) FILTER (WHERE p."isActive" = true AND (pcs."hasCost" IS NULL OR pcs."hasCost" = false)) AS "noCost",
      COUNT(*) FILTER (WHERE p."isActive" = true AND (pcs."hasPrice" IS NULL OR pcs."hasPrice" = false)) AS "noPrice",
      COUNT(*) FILTER (WHERE p."isActive" = true AND (pcs."hasCode" IS NULL OR pcs."hasCode" = false)) AS "noCode",
      COUNT(*) FILTER (WHERE p."isActive" = true AND pcs."costEqualsPrice" = true) AS "costEqualsPrice",
      -- "Sin categoría" no existe de verdad (categoryId es obligatorio en el
      -- schema) — lo único detectable es "en una categoría genérica tipo
      -- cajón de sastre", por NOMBRE (no hay ningún código reservado para
      -- eso en el sistema). Heurística honesta, no una regla de negocio.
      COUNT(*) FILTER (WHERE p."isActive" = true AND c.name ILIKE '%general%') AS "noCategory"
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
  };
}
