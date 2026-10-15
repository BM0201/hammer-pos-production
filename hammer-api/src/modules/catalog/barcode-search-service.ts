import { Prisma, PrismaClient, ProductBarcodeKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeScannedCode } from "@/modules/catalog/barcode";
import { detectBarcodeIssues, type BarcodeIssue } from "@/modules/catalog/barcode-issues";

/**
 * Fase 1.3 (prompt-codigos-editar-eliminar.md) — "Buscar códigos" general,
 * para limpiar en lote. Dos caminos:
 *
 * - SIN `issue`: todo a nivel DB, paginado por cursor — rápido, nunca carga
 *   la tabla entera. `q` hace "exacta primero, después contiene" (escanear
 *   un código registrado devuelve su fila directo).
 * - CON `issue`: CHECKSUM_INVALID/MULTIPLE_CODES/NO_PRIMARY/
 *   INTERNAL_SKU_MISMATCH no son expresables como un WHERE simple (dependen
 *   de calcular el dígito verificador o contar hermanos por producto) — se
 *   trae la tabla completa UNA vez, se calculan los issues en memoria, y
 *   ENTONCES se filtra/pagina. Aceptable para una pantalla de
 *   administración de uso esporádico; si ProductBarcode creciera a
 *   centenas de miles de filas, esto necesitaría un cálculo precomputado
 *   (columna/trabajo en segundo plano), no antes.
 */

export type BarcodeRowProduct = { id: string; name: string; sku: string; isActive: boolean; isMerged: boolean; barcodeCount: number };
export type BarcodeSearchRow = { id: string; code: string; kind: ProductBarcodeKind; isPrimary: boolean; createdAt: string; product: BarcodeRowProduct; issues: BarcodeIssue[] };
export type BarcodeSearchResult = { barcodes: BarcodeSearchRow[]; nextCursor: string | null };

export type BarcodeSearchInput = { q?: string; kind?: ProductBarcodeKind; issue?: BarcodeIssue; cursor?: string; limit: number };

type RawRow = {
  id: string;
  code: string;
  kind: ProductBarcodeKind;
  isPrimary: boolean;
  createdAt: Date;
  productId: string;
  product: { id: string; name: string; sku: string; isActive: boolean; mergedIntoProductId: string | null };
};

function toRow(row: RawRow, siblingCount: number, productHasPrimary: boolean): BarcodeSearchRow {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    isPrimary: row.isPrimary,
    createdAt: row.createdAt.toISOString(),
    product: { id: row.product.id, name: row.product.name, sku: row.product.sku, isActive: row.product.isActive, isMerged: row.product.mergedIntoProductId !== null, barcodeCount: siblingCount },
    issues: detectBarcodeIssues({
      code: row.code,
      kind: row.kind,
      productIsActive: row.product.isActive,
      productMergedIntoProductId: row.product.mergedIntoProductId,
      productSku: row.product.sku,
      siblingCount,
      productHasPrimary,
    }),
  };
}

const PRODUCT_SELECT = { id: true, name: true, sku: true, isActive: true, mergedIntoProductId: true } as const;

/** Cuenta de códigos y "¿tiene algún principal?" por producto — batched sobre los ids tocados en ESTA página (nunca toda la tabla). */
async function productAggregates(db: PrismaClient, productIds: string[]): Promise<{ countByProduct: Map<string, number>; hasPrimaryByProduct: Map<string, boolean> }> {
  if (productIds.length === 0) return { countByProduct: new Map(), hasPrimaryByProduct: new Map() };
  const [counts, primaries] = await Promise.all([
    db.productBarcode.groupBy({ by: ["productId"], where: { productId: { in: productIds } }, _count: { _all: true } }),
    db.productBarcode.findMany({ where: { productId: { in: productIds }, isPrimary: true }, select: { productId: true } }),
  ]);
  return {
    countByProduct: new Map(counts.map((c) => [c.productId, c._count._all])),
    hasPrimaryByProduct: new Map(primaries.map((p) => [p.productId, true])),
  };
}

async function searchPaginated(input: BarcodeSearchInput, db: PrismaClient): Promise<BarcodeSearchResult> {
  const normalizedQ = input.q ? normalizeScannedCode(input.q) : undefined;

  let exact: RawRow | null = null;
  if (normalizedQ && !input.cursor) {
    const found = await db.productBarcode.findUnique({ where: { code: normalizedQ }, include: { product: { select: PRODUCT_SELECT } } });
    if (found && (!input.kind || found.kind === input.kind)) exact = found;
  }

  const where: Prisma.ProductBarcodeWhereInput = {
    ...(input.kind ? { kind: input.kind } : {}),
    ...(exact ? { id: { not: exact.id } } : {}),
    ...(input.q
      ? {
          OR: [
            { code: { contains: input.q, mode: "insensitive" } },
            { product: { name: { contains: input.q, mode: "insensitive" } } },
            { product: { sku: { contains: input.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const remainingLimit = Math.max(0, input.limit - (exact ? 1 : 0));
  const rows = remainingLimit > 0
    ? await db.productBarcode.findMany({
        where,
        include: { product: { select: PRODUCT_SELECT } },
        orderBy: { createdAt: "desc" },
        take: remainingLimit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      })
    : [];
  const hasMore = rows.length > remainingLimit;
  const page = hasMore ? rows.slice(0, remainingLimit) : rows;

  const allRows = exact ? [exact, ...page] : page;
  const productIds = [...new Set(allRows.map((r) => r.productId))];
  const { countByProduct, hasPrimaryByProduct } = await productAggregates(db, productIds);

  const barcodes = allRows.map((r) => toRow(r, countByProduct.get(r.productId) ?? 1, hasPrimaryByProduct.get(r.productId) ?? false));
  return { barcodes, nextCursor: hasMore ? page.at(-1)?.id ?? null : null };
}

/** Trae TODA la tabla (con los joins necesarios), calcula issues por fila y filtra. Usado por el camino `issue` y por el export CSV completo. */
async function fetchAllWithIssues(db: PrismaClient, filters: { q?: string; kind?: ProductBarcodeKind; issue?: BarcodeIssue }): Promise<BarcodeSearchRow[]> {
  const all = await db.productBarcode.findMany({
    include: { product: { select: PRODUCT_SELECT } },
    orderBy: { createdAt: "desc" },
  });

  const countByProduct = new Map<string, number>();
  const hasPrimaryByProduct = new Map<string, boolean>();
  for (const row of all) {
    countByProduct.set(row.productId, (countByProduct.get(row.productId) ?? 0) + 1);
    if (row.isPrimary) hasPrimaryByProduct.set(row.productId, true);
  }

  const normalizedQ = filters.q?.toLowerCase();
  return all
    .map((r) => toRow(r, countByProduct.get(r.productId) ?? 1, hasPrimaryByProduct.get(r.productId) ?? false))
    .filter((r) => !filters.kind || r.kind === filters.kind)
    .filter((r) => !filters.issue || r.issues.includes(filters.issue))
    .filter((r) => !normalizedQ || r.code.toLowerCase().includes(normalizedQ) || r.product.name.toLowerCase().includes(normalizedQ) || r.product.sku.toLowerCase().includes(normalizedQ));
}

async function searchByIssue(input: BarcodeSearchInput, db: PrismaClient): Promise<BarcodeSearchResult> {
  const filtered = await fetchAllWithIssues(db, input);
  const startIdx = input.cursor ? filtered.findIndex((r) => r.id === input.cursor) + 1 : 0;
  const page = filtered.slice(startIdx, startIdx + input.limit);
  const nextCursor = startIdx + input.limit < filtered.length ? (page.at(-1)?.id ?? null) : null;
  return { barcodes: page, nextCursor };
}

export async function searchBarcodes(input: BarcodeSearchInput, db: PrismaClient = prisma): Promise<BarcodeSearchResult> {
  return input.issue ? searchByIssue(input, db) : searchPaginated(input, db);
}

/** Export CSV (Fase 1.3) — SIEMPRE el set completo que coincide con los filtros, nunca una sola página. */
export async function listAllBarcodesForExport(filters: { q?: string; kind?: ProductBarcodeKind; issue?: BarcodeIssue }, db: PrismaClient = prisma): Promise<BarcodeSearchRow[]> {
  return fetchAllWithIssues(db, filters);
}

export type BarcodeCoverage = { withBarcode: number; total: number };

/**
 * Fase 3.2 — "Productos con código: 1,412 de 3,705 · 38%", filtrable por
 * sucursal y categoría. Mismo filtro de visibilidad por sucursal que el
 * resto del catálogo (branchProductScopeFilter) — "con código" cuenta
 * `barcodes: { some: {} }` en vez de leer Product.barcode directo porque
 * ese campo es solo un espejo del principal, mantenido por
 * product-barcode-service.ts; la tabla ProductBarcode es la fuente real.
 */
export async function getBarcodeCoverage(filters: { branchId?: string; categoryId?: string }, db: PrismaClient = prisma): Promise<BarcodeCoverage> {
  const { branchProductScopeFilter } = await import("@/modules/catalog/branch-product-scope");
  const where: Prisma.ProductWhereInput = {
    isActive: true,
    mergedIntoProductId: null,
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.branchId ? branchProductScopeFilter(filters.branchId) : {}),
  };
  const [withBarcode, total] = await Promise.all([
    db.product.count({ where: { ...where, barcodes: { some: {} } } }),
    db.product.count({ where }),
  ]);
  return { withBarcode, total };
}

export type CategoryWalkCandidate = { productId: string; name: string; sku: string; stockInBranch: number };

/**
 * Fase 3.2 — "Recorrer por categoría": productos SIN código de esa
 * categoría, con stock primero (lo que más rota conviene etiquetarlo
 * antes — el orden final por stock lo decide la pantalla, acá solo se
 * manda el número).
 */
export async function listProductsWithoutBarcodeForCategoryWalk(
  input: { categoryId: string; branchId: string },
  db: PrismaClient = prisma,
): Promise<CategoryWalkCandidate[]> {
  const products = await db.product.findMany({
    where: { categoryId: input.categoryId, isActive: true, mergedIntoProductId: null, barcodes: { none: {} } },
    select: { id: true, name: true, sku: true },
  });
  if (products.length === 0) return [];

  const balances = await db.inventoryBalance.findMany({
    where: { branchId: input.branchId, productId: { in: products.map((p) => p.id) } },
    select: { productId: true, quantityOnHand: true },
  });
  const stockByProduct = new Map(balances.map((b) => [b.productId, Number(b.quantityOnHand)]));

  return products.map((p) => ({ productId: p.id, name: p.name, sku: p.sku, stockInBranch: stockByProduct.get(p.id) ?? 0 }));
}

/** Fase 3.1 — "Con problemas (N)... con chips por problema y su conteo": el total real por issue, para la pestaña y sus chips (no solo lo que entra en una página). */
export async function countBarcodeIssues(db: PrismaClient = prisma): Promise<Record<BarcodeIssue, number>> {
  const rows = await fetchAllWithIssues(db, {});
  const counts: Record<BarcodeIssue, number> = { CHECKSUM_INVALID: 0, PRODUCT_INACTIVE: 0, PRODUCT_MERGED: 0, MULTIPLE_CODES: 0, INTERNAL_SKU_MISMATCH: 0, NO_PRIMARY: 0 };
  for (const row of rows) for (const issue of row.issues) counts[issue] += 1;
  return counts;
}
