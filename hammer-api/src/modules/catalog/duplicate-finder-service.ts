import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  findDuplicateCandidates,
  dismissedPairKey,
  type DuplicateCandidateProduct,
  type DuplicateCandidatePair,
} from "@/modules/catalog/duplicate-finder";
import { excludeDerivedStockGroupMembers } from "@/modules/catalog/service";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * prompt-codigos-y-duplicados.md Fase 4 — resuelve los datos reales
 * (productos activos + su stock total + descartes ya guardados) y delega
 * la decisión "¿se parecen?" a duplicate-finder.ts (pura, ya probada
 * aparte). excludeDerivedStockGroupMembers: un miembro derivado de una
 * fusión de presentaciones no es un "producto duplicado" — es la misma
 * fusión que ya resuelve inventory-fusion, no tiene sentido sugerir
 * unificarlo de nuevo acá.
 */
export async function getDuplicateCandidates(db: Db = prisma): Promise<DuplicateCandidatePair[]> {
  const products = await db.product.findMany({
    where: { isActive: true, mergedIntoProductId: null, ...excludeDerivedStockGroupMembers() },
    select: {
      id: true,
      sku: true,
      name: true,
      categoryId: true,
      unit: true,
      barcode: true,
      createdAt: true,
      inventoryBalances: { select: { quantityOnHand: true } },
    },
  });

  const candidateProducts: DuplicateCandidateProduct[] = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    categoryId: p.categoryId,
    unit: p.unit,
    barcode: p.barcode,
    createdAt: p.createdAt,
    totalStock: p.inventoryBalances.reduce((sum, b) => sum + Number(b.quantityOnHand), 0),
  }));

  const dismissals = await db.productDuplicateDismissal.findMany({ select: { pairKey: true } });
  const dismissedPairs = new Set(dismissals.map((d) => d.pairKey));

  return findDuplicateCandidates(candidateProducts, dismissedPairs);
}

export async function dismissDuplicatePair(
  input: { productAId: string; productBId: string; actorUserId: string; reason?: string },
  db: Db = prisma,
) {
  const pairKey = dismissedPairKey(input.productAId, input.productBId);
  return db.productDuplicateDismissal.upsert({
    where: { pairKey },
    create: {
      pairKey,
      productAId: input.productAId,
      productBId: input.productBId,
      dismissedByUserId: input.actorUserId,
      reason: input.reason ?? null,
    },
    update: {
      dismissedByUserId: input.actorUserId,
      dismissedAt: new Date(),
      reason: input.reason ?? null,
    },
  });
}
