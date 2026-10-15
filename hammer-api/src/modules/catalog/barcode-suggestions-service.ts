import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  rankBarcodeSuggestions,
  MANUFACTURER_PREFIX_MIN_LENGTH,
  type ManufacturerSibling,
  type RecentSessionProduct,
  type SuggestionCandidate,
  type SuggestionReason,
} from "@/modules/catalog/barcode-suggestions";

/**
 * Fase 2 (prompt-codigos-editar-eliminar.md) — resuelve los datos reales
 * (hermanos de marca, pool de candidatos acotado, contexto de sesión,
 * stock/actividad reciente) y llama a rankBarcodeSuggestions (puro). Esta
 * capa SOLO junta datos; la decisión de qué pesa cuánto vive en el módulo
 * puro de al lado.
 */

const CANDIDATE_POOL_LIMIT = 300;
const QUERY_POOL_LIMIT = 50;
const RECENT_ACTIVITY_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

export type BarcodeSuggestionCard = {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  categoryName: string;
  stockInBranch: number;
  hasBarcode: boolean;
  score: number;
  reasons: SuggestionReason[];
};

/**
 * Prefijo común MÁS LARGO entre `code` y los FACTORY ya registrados —
 * probando largos decrecientes (10 → MANUFACTURER_PREFIX_MIN_LENGTH) con el
 * índice de prefijo (text_pattern_ops, migración de esta fase) en vez de
 * traer la tabla entera a memoria para compararla carácter por carácter.
 */
async function findManufacturerSiblingsTx(db: PrismaClient, code: string): Promise<ManufacturerSibling[]> {
  if (!/^\d+$/.test(code)) return [];
  const maxTry = Math.min(10, code.length - 1);
  for (let len = maxTry; len >= MANUFACTURER_PREFIX_MIN_LENGTH; len -= 1) {
    const prefix = code.slice(0, len);
    const rows = await db.$queryRaw<Array<{ code: string; productId: string; name: string; unit: string; categoryId: string }>>`
      SELECT pb.code, pb."productId", p.name, p.unit, p."categoryId"
      FROM "ProductBarcode" pb
      JOIN "Product" p ON p.id = pb."productId"
      WHERE pb.kind = 'FACTORY' AND pb.code LIKE ${prefix + "%"}
      LIMIT 50
    `;
    if (rows.length > 0) {
      return rows.map((r) => ({ productId: r.productId, barcodeCode: r.code, name: r.name, unit: r.unit, categoryId: r.categoryId }));
    }
  }
  return [];
}

export async function suggestProductsForBarcode(
  input: { code: string; query?: string; branchId?: string; recentProductIds?: string[] },
  db: PrismaClient = prisma,
): Promise<{ suggestions: BarcodeSuggestionCard[] }> {
  const manufacturerSiblings = await findManufacturerSiblingsTx(db, input.code);

  const recentIds = (input.recentProductIds ?? []).slice(0, 3);
  const recentProductsRaw = recentIds.length > 0
    ? await db.product.findMany({ where: { id: { in: recentIds } }, select: { id: true, name: true, categoryId: true, unit: true } })
    : [];
  // En el MISMO orden que recentIds (el [0] debe ser el más reciente) — findMany no garantiza el orden de `in`.
  const recentById = new Map(recentProductsRaw.map((p) => [p.id, p]));
  const recentSessionProducts: RecentSessionProduct[] = recentIds
    .map((id) => recentById.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ productId: p.id, name: p.name, categoryId: p.categoryId, unit: p.unit }));

  const siblingCategoryIds = [...new Set(manufacturerSiblings.map((s) => s.categoryId))];
  const sessionCategoryIds = [...new Set(recentSessionProducts.map((p) => p.categoryId))];
  const categoryIds = [...new Set([...siblingCategoryIds, ...sessionCategoryIds])];

  const [categoryPool, queryPool] = await Promise.all([
    categoryIds.length > 0
      ? db.product.findMany({
          where: { categoryId: { in: categoryIds }, isActive: true, barcodes: { none: {} } },
          select: { id: true, name: true, sku: true, unit: true, categoryId: true, isActive: true, mergedIntoProductId: true, category: { select: { name: true } } },
          take: CANDIDATE_POOL_LIMIT,
        })
      : Promise.resolve([]),
    input.query
      ? db.product.findMany({
          where: { name: { contains: input.query, mode: "insensitive" } },
          select: { id: true, name: true, sku: true, unit: true, categoryId: true, isActive: true, mergedIntoProductId: true, category: { select: { name: true } } },
          take: QUERY_POOL_LIMIT,
        })
      : Promise.resolve([]),
  ]);

  const poolById = new Map([...categoryPool, ...queryPool].map((p) => [p.id, p]));
  const pool = [...poolById.values()].slice(0, CANDIDATE_POOL_LIMIT);
  const poolIds = pool.map((p) => p.id);

  const [barcodeCounts, balances, recentMovements] = await Promise.all([
    poolIds.length > 0 ? db.productBarcode.groupBy({ by: ["productId"], where: { productId: { in: poolIds } }, _count: { _all: true } }) : Promise.resolve([]),
    input.branchId && poolIds.length > 0 ? db.inventoryBalance.findMany({ where: { branchId: input.branchId, productId: { in: poolIds } }, select: { productId: true, quantityOnHand: true } }) : Promise.resolve([]),
    poolIds.length > 0
      ? db.inventoryMovement.groupBy({
          by: ["productId"],
          where: { productId: { in: poolIds }, movementType: { in: ["SALE_OUT", "PURCHASE_IN"] }, createdAt: { gte: new Date(Date.now() - RECENT_ACTIVITY_WINDOW_MS) } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);
  const barcodeCountByProduct = new Map(barcodeCounts.map((c) => [c.productId, c._count._all]));
  const stockByProduct = new Map(balances.map((b) => [b.productId, Number(b.quantityOnHand)]));
  const recentActivityProductIds = new Set(recentMovements.map((m) => m.productId));

  const candidates: SuggestionCandidate[] = pool.map((p) => ({
    productId: p.id,
    name: p.name,
    sku: p.sku,
    unit: p.unit,
    categoryId: p.categoryId,
    hasBarcode: (barcodeCountByProduct.get(p.id) ?? 0) > 0,
    isActive: p.isActive,
    isMerged: p.mergedIntoProductId !== null,
    stockInBranch: stockByProduct.get(p.id) ?? 0,
    recentActivity60d: recentActivityProductIds.has(p.id),
  }));

  const ranked = rankBarcodeSuggestions({ code: input.code, query: input.query, manufacturerSiblings, recentSessionProducts, candidates });
  const candidateById = new Map(pool.map((p) => [p.id, p]));

  const suggestions: BarcodeSuggestionCard[] = ranked.map((r) => {
    const p = candidateById.get(r.productId)!;
    return {
      productId: r.productId,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      categoryName: p.category.name,
      stockInBranch: stockByProduct.get(r.productId) ?? 0,
      hasBarcode: (barcodeCountByProduct.get(r.productId) ?? 0) > 0,
      score: r.score,
      reasons: r.reasons,
    };
  });

  return { suggestions };
}

/**
 * Fase 2.5 — posibles duplicados tras vincular un código al producto A:
 * otros productos CON código que se parecen (Dice ≥
 * DUPLICATE_SIMILARITY_THRESHOLD), respetando los pares ya descartados.
 * Mismo motor que la pantalla de Duplicados (findDuplicateCandidates) —
 * acá solo se acota a los pares que involucran a `productId`, no se
 * recalcula el catálogo entero.
 */
export async function findPossibleDuplicatesAfterLink(
  productId: string,
  db: PrismaClient = prisma,
): Promise<Array<{ id: string; name: string; sku: string }>> {
  const { findDuplicateCandidates, dismissedPairKey, DUPLICATE_SIMILARITY_THRESHOLD } = await import("@/modules/catalog/duplicate-finder");
  const { excludeDerivedStockGroupMembers } = await import("@/modules/catalog/service");

  const product = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, name: true, categoryId: true, unit: true, barcode: true, createdAt: true, isActive: true, inventoryBalances: { select: { quantityOnHand: true } } },
  });
  if (!product || !product.isActive) return [];

  const sameBlock = await db.product.findMany({
    where: { categoryId: product.categoryId, unit: product.unit, isActive: true, id: { not: productId }, barcode: { not: null }, ...excludeDerivedStockGroupMembers() },
    select: { id: true, sku: true, name: true, categoryId: true, unit: true, barcode: true, createdAt: true, isActive: true, inventoryBalances: { select: { quantityOnHand: true } } },
  });
  if (sameBlock.length === 0) return [];

  const dismissals = await db.productDuplicateDismissal.findMany({ where: { OR: [{ productAId: productId }, { productBId: productId }] }, select: { pairKey: true } });
  const dismissedPairs = new Set(dismissals.map((d) => d.pairKey));

  const toCandidate = (p: typeof product) => ({
    id: p.id, sku: p.sku, name: p.name, categoryId: p.categoryId, unit: p.unit, barcode: p.barcode, createdAt: p.createdAt,
    totalStock: p.inventoryBalances.reduce((sum, b) => sum + Number(b.quantityOnHand), 0),
  });

  const pairs = findDuplicateCandidates([toCandidate(product), ...sameBlock.map(toCandidate)], dismissedPairs);

  return pairs
    .filter((pair) => pair.similarity >= DUPLICATE_SIMILARITY_THRESHOLD && (pair.productA.id === productId || pair.productB.id === productId) && !dismissedPairs.has(dismissedPairKey(pair.productA.id, pair.productB.id)))
    .map((pair) => (pair.productA.id === productId ? pair.productB : pair.productA))
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku }));
}

export type SuggestionAcceptanceStats = { total: number; pickedFirst: number; pickedTop3: number; pickedOther: number; pickedNone: number };

/**
 * Fase 2.4 — "% de veces que se eligió la 1.ª sugerencia, la top 3 o
 * ninguna, en 30 días." Se calcula de PRODUCT_BARCODE_ADDED: `suggestion`
 * ausente = "ninguna" (el código se vinculó por otro camino, no desde una
 * tarjeta sugerida). Límite honesto: un alta de código totalmente AJENA al
 * flujo de "código no encontrado → sugerencias" (p.ej. agregar un código
 * desde la ficha del producto) también cae en "ninguna" — no hay, hoy, un
 * evento separado de "se mostraron sugerencias" para distinguir ambos
 * casos. Sirve igual para la pregunta que importa (¿se usan las
 * sugerencias cuando se muestran?), pero el % de "ninguna" es un piso, no
 * un número exacto.
 */
export async function getSuggestionAcceptanceStats(db: PrismaClient = prisma): Promise<SuggestionAcceptanceStats> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const logs = await db.auditLog.findMany({
    where: { action: "PRODUCT_BARCODE_ADDED", occurredAt: { gte: since } },
    select: { metadataJson: true },
  });

  const stats: SuggestionAcceptanceStats = { total: logs.length, pickedFirst: 0, pickedTop3: 0, pickedOther: 0, pickedNone: 0 };
  for (const log of logs) {
    const metadata = log.metadataJson as { suggestion?: { rank: number } | null } | null;
    const rank = metadata?.suggestion?.rank;
    if (rank === undefined || rank === null) stats.pickedNone += 1;
    else if (rank === 1) stats.pickedFirst += 1;
    else if (rank <= 3) stats.pickedTop3 += 1;
    else stats.pickedOther += 1;
  }
  return stats;
}
