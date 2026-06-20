import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type SalesFilters = {
  dateFrom?: Date;
  dateTo?: Date;
  branchIds?: string[];
};

type DayPaymentRow = { date: string; total_sold: number; orders_count: number };
type DayLineRow = { date: string; units_sold: number; distinct_products: number };
type TopProductRow = {
  product_id: string;
  sku: string;
  name: string;
  category_name: string;
  total_qty: number;
  total_sold: number;
};
type BranchRow = {
  branch_id: string;
  branch_code: string;
  branch_name: string;
  total_sold: number;
  orders_count: number;
};
type CategoryRow = {
  category_id: string;
  category_name: string;
  total_sold: number;
  orders_count: number;
};
type DistinctRow = { count: number };

export type SalesByDayRow = {
  date: string;
  total_sold: number;
  orders_count: number;
  units_sold: number;
  distinct_products: number;
};

export type ProductsByDayRow = {
  date: string;
  product_id: string;
  sku: string;
  name: string;
  category_name: string;
  total_qty: number;
  total_sold: number;
};

export async function getSalesSummaryAggregated(filters: SalesFilters) {
  const dateFrom = filters.dateFrom ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const dateTo = filters.dateTo ?? new Date();

  const branchSql =
    filters.branchIds && filters.branchIds.length > 0
      ? Prisma.sql`AND o."branchId" IN (${Prisma.join(filters.branchIds)})`
      : Prisma.sql``;

  const statusSql = Prisma.sql`AND o.status IN ('PAID', 'DISPATCH_PENDING', 'DISPATCHED')`;

  // Payment-level aggregation by day (totals include transport)
  const paymentByDay = await prisma.$queryRaw<DayPaymentRow[]>`
    SELECT
      DATE(p."paidAt")::text                          AS date,
      SUM(p.amount)::float8                           AS total_sold,
      COUNT(DISTINCT p."saleOrderId")::int            AS orders_count
    FROM "Payment" p
    INNER JOIN "SaleOrder" o ON o.id = p."saleOrderId"
    WHERE p.status = 'POSTED'
      AND p."paidAt" >= ${dateFrom}
      AND p."paidAt" <= ${dateTo}
      ${branchSql}
      ${statusSql}
    GROUP BY DATE(p."paidAt")
    ORDER BY 1
  `;

  // Line-level aggregation by day (product units; excludes transport)
  const linesByDay = await prisma.$queryRaw<DayLineRow[]>`
    SELECT
      DATE(p."paidAt")::text                          AS date,
      SUM(l.quantity)::float8                         AS units_sold,
      COUNT(DISTINCT l."productId")::int              AS distinct_products
    FROM "SaleOrderLine" l
    INNER JOIN "SaleOrder" o ON o.id = l."saleOrderId"
    INNER JOIN "Payment" p ON p."saleOrderId" = o.id
    WHERE p.status = 'POSTED'
      AND p."paidAt" >= ${dateFrom}
      AND p."paidAt" <= ${dateTo}
      ${branchSql}
      ${statusSql}
    GROUP BY DATE(p."paidAt")
    ORDER BY 1
  `;

  // Merge by day
  const lineMap = new Map(linesByDay.map((r) => [String(r.date), r]));
  const byDay: SalesByDayRow[] = paymentByDay.map((r) => {
    const lines = lineMap.get(String(r.date));
    return {
      date: String(r.date),
      total_sold: r.total_sold,
      orders_count: r.orders_count,
      units_sold: lines?.units_sold ?? 0,
      distinct_products: lines?.distinct_products ?? 0,
    };
  });

  // Global KPIs
  const totalSold = byDay.reduce((s, r) => s + r.total_sold, 0);
  const ordersCount = byDay.reduce((s, r) => s + r.orders_count, 0);
  const unitsSold = byDay.reduce((s, r) => s + r.units_sold, 0);
  const avgTicket = ordersCount > 0 ? totalSold / ordersCount : 0;

  // Total distinct products in period
  const [distinctRow] = await prisma.$queryRaw<DistinctRow[]>`
    SELECT COUNT(DISTINCT l."productId")::int AS count
    FROM "SaleOrderLine" l
    INNER JOIN "SaleOrder" o ON o.id = l."saleOrderId"
    INNER JOIN "Payment" p ON p."saleOrderId" = o.id
    WHERE p.status = 'POSTED'
      AND p."paidAt" >= ${dateFrom}
      AND p."paidAt" <= ${dateTo}
      ${branchSql}
      ${statusSql}
  `;

  // Top 20 products (sorted by qty; client can re-sort by amount)
  const topProducts = await prisma.$queryRaw<TopProductRow[]>`
    SELECT
      l."productId"                                     AS product_id,
      pr.sku,
      pr.name,
      COALESCE(cat.name, 'Sin categoría')               AS category_name,
      SUM(l.quantity)::float8                           AS total_qty,
      SUM(l."lineSubtotal")::float8                     AS total_sold
    FROM "SaleOrderLine" l
    INNER JOIN "SaleOrder" o ON o.id = l."saleOrderId"
    INNER JOIN "Payment" p ON p."saleOrderId" = o.id
    INNER JOIN "Product" pr ON pr.id = l."productId"
    LEFT JOIN "Category" cat ON cat.id = pr."categoryId"
    WHERE p.status = 'POSTED'
      AND p."paidAt" >= ${dateFrom}
      AND p."paidAt" <= ${dateTo}
      ${branchSql}
      ${statusSql}
    GROUP BY l."productId", pr.sku, pr.name, cat.name
    ORDER BY total_qty DESC
    LIMIT 20
  `;

  // By branch
  const byBranch = await prisma.$queryRaw<BranchRow[]>`
    SELECT
      o."branchId"                                      AS branch_id,
      b.code                                            AS branch_code,
      b.name                                            AS branch_name,
      SUM(p.amount)::float8                             AS total_sold,
      COUNT(DISTINCT p."saleOrderId")::int              AS orders_count
    FROM "Payment" p
    INNER JOIN "SaleOrder" o ON o.id = p."saleOrderId"
    INNER JOIN "Branch" b ON b.id = o."branchId"
    WHERE p.status = 'POSTED'
      AND p."paidAt" >= ${dateFrom}
      AND p."paidAt" <= ${dateTo}
      ${branchSql}
      ${statusSql}
    GROUP BY o."branchId", b.code, b.name
    ORDER BY total_sold DESC
  `;

  // By category (product subtotals, excludes transport)
  const byCategory = await prisma.$queryRaw<CategoryRow[]>`
    SELECT
      COALESCE(cat.id, '')                              AS category_id,
      COALESCE(cat.name, 'Sin categoría')               AS category_name,
      SUM(l."lineSubtotal")::float8                     AS total_sold,
      COUNT(DISTINCT o.id)::int                         AS orders_count
    FROM "SaleOrderLine" l
    INNER JOIN "SaleOrder" o ON o.id = l."saleOrderId"
    INNER JOIN "Payment" p ON p."saleOrderId" = o.id
    INNER JOIN "Product" pr ON pr.id = l."productId"
    LEFT JOIN "Category" cat ON cat.id = pr."categoryId"
    WHERE p.status = 'POSTED'
      AND p."paidAt" >= ${dateFrom}
      AND p."paidAt" <= ${dateTo}
      ${branchSql}
      ${statusSql}
    GROUP BY cat.id, cat.name
    ORDER BY total_sold DESC
  `;

  return {
    kpis: {
      totalSold,
      ordersCount,
      unitsSold,
      avgTicket,
      distinctProducts: distinctRow?.count ?? 0,
    },
    byDay,
    topProducts,
    byBranch,
    byCategory,
    generatedAt: new Date().toISOString(),
  };
}

export async function getSalesProductsByDay(
  filters: SalesFilters & { date?: string },
) {
  const dateFrom = filters.dateFrom ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const dateTo = filters.dateTo ?? new Date();

  const branchSql =
    filters.branchIds && filters.branchIds.length > 0
      ? Prisma.sql`AND o."branchId" IN (${Prisma.join(filters.branchIds)})`
      : Prisma.sql``;

  const statusSql = Prisma.sql`AND o.status IN ('PAID', 'DISPATCH_PENDING', 'DISPATCHED')`;
  const dateSql = filters.date
    ? Prisma.sql`AND DATE(p."paidAt") = ${filters.date}::date`
    : Prisma.sql``;

  return prisma.$queryRaw<ProductsByDayRow[]>`
    SELECT
      DATE(p."paidAt")::text                            AS date,
      l."productId"                                     AS product_id,
      pr.sku,
      pr.name,
      COALESCE(cat.name, 'Sin categoría')               AS category_name,
      SUM(l.quantity)::float8                           AS total_qty,
      SUM(l."lineSubtotal")::float8                     AS total_sold
    FROM "SaleOrderLine" l
    INNER JOIN "SaleOrder" o ON o.id = l."saleOrderId"
    INNER JOIN "Payment" p ON p."saleOrderId" = o.id
    INNER JOIN "Product" pr ON pr.id = l."productId"
    LEFT JOIN "Category" cat ON cat.id = pr."categoryId"
    WHERE p.status = 'POSTED'
      AND p."paidAt" >= ${dateFrom}
      AND p."paidAt" <= ${dateTo}
      ${branchSql}
      ${statusSql}
      ${dateSql}
    GROUP BY DATE(p."paidAt"), l."productId", pr.sku, pr.name, cat.name
    ORDER BY 1, total_qty DESC
    LIMIT 1000
  `;
}
