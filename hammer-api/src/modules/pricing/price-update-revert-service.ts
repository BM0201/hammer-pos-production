import { prisma } from "@/lib/prisma";
import { createDraft, type CreateDraftItem } from "@/modules/pricing/price-update-batch-service";

/**
 * prompt-carga-precios.md Fase 4 — "Rehacer conflictos" (price-load-tab.tsx)
 * ya arma un borrador nuevo a mano con los productos en conflicto; esto es
 * distinto: reversión COMPLETA de una carga ya aplicada. Un borrador
 * nuevo (source=REVERT, revertsBatchId=original) con una línea por cada
 * línea APPLIED de la original, newPrice=appliedPreviousPrice — createDraft
 * (Fase 1) toma una foto FRESCA de hoy, así que pasa por las MISMAS reglas
 * de bloqueo/conflicto que cualquier carga nueva (si alguien volvió a
 * cambiar el precio después, esta línea también queda en CONFLICT, no se
 * revierte a ciegas). `appliedPreviousPrice === null` (la sucursal no tenía
 * excepción antes de la carga original) usa el sentinel 0 — ver el
 * comentario en createDraftTx (price-update-batch-service.ts).
 */
export async function revertPriceUpdateBatch(originalBatchId: string, actorUserId: string): Promise<{ batchId: string; code: string }> {
  const original = await prisma.priceUpdateBatch.findUniqueOrThrow({ where: { id: originalBatchId } });

  const appliedLines = await prisma.priceUpdateLine.findMany({
    where: { batchId: originalBatchId, status: "APPLIED" },
    select: { productId: true, branchId: true, appliedPreviousPrice: true },
  });
  if (appliedLines.length === 0) {
    throw new Error("VALIDATION_ERROR: Esta carga no tiene líneas aplicadas para revertir.");
  }

  const items: CreateDraftItem[] = appliedLines.map((line) => ({
    productId: line.productId,
    newPrice: line.appliedPreviousPrice != null ? Number(line.appliedPreviousPrice) : 0,
  }));

  const branchIds = original.target === "GENERAL"
    ? []
    : [...new Set(appliedLines.map((l) => l.branchId).filter((b): b is string => b != null))];

  const { batchId, code } = await createDraft({
    target: original.target,
    branchIds,
    reason: `Reversión de ${original.code}`,
    source: "REVERT",
    items,
    actorUserId,
  });

  await prisma.priceUpdateBatch.update({ where: { id: batchId }, data: { revertsBatchId: originalBatchId } });

  return { batchId, code };
}
