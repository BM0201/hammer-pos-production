import { Prisma } from "@prisma/client";
import type { PriceUpdateBatch, PriceUpdateBatchStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolvePolicyForProductBatch } from "@/modules/pricing/category-policy-service";
import { classifyLine } from "@/modules/pricing/price-update-rules";
import { setBranchPriceTx } from "@/modules/pricing/branch-price-exception-service";
import { setStandardSalePriceTx } from "@/modules/pricing/standard-price-writer";
import { snapshotForBranch, snapshotForGeneral, type LineSnapshot } from "@/modules/pricing/price-update-batch-service";

/**
 * prompt-carga-precios.md Fase 2 — aplicación atómica de una carga ya
 * armada (Fase 1, price-update-batch-service.ts). Reglas duras:
 *   - la vista previa NO es garantía: cada línea se re-valida con datos
 *     frescos (costo/precio vigente) en el momento de aplicar, nunca con
 *     la foto congelada;
 *   - si el precio vigente ya no coincide con la foto de la línea, la
 *     línea queda en CONFLICT y nunca se pisa;
 *   - procesa de a LINE_CHUNK_SIZE líneas por transacción (el timeout de
 *     Neon no perdona una carga de miles de líneas en una sola tx);
 *   - reanudable: una carga en APPLYING (se cayó a mitad de camino) se
 *     puede volver a aplicar y solo toca lo que sigue PENDING. Una carga
 *     ya terminada (APPLIED/PARTIAL/CANCELLED) da ALREADY_PROCESSED.
 */

const LINE_CHUNK_SIZE = 50;

export type ApplyBatchInput = { acknowledgeWarnings: boolean; actorUserId: string };
export type ApplyBatchResult = { batchId: string; status: PriceUpdateBatchStatus; totals: Record<string, number> };

/**
 * ¿Hay alguna línea PENDING que vaya a aplicarse con un aviso (margen bajo
 * la política, cambio >30%, sin costo)? Se corre con el prisma global,
 * FUERA de la transacción de aplicar — es un gate de UX (el checkbox "Revisé
 * los avisos"), no un control de plata: el bloqueo real por costo/inactivo/
 * fusión se re-valida de todas formas, sin excepción, dentro de cada
 * transacción de línea más abajo.
 */
export async function batchHasPendingWarnings(batchId: string): Promise<boolean> {
  const lines = await prisma.priceUpdateLine.findMany({
    where: { batchId, status: "PENDING", newPrice: { not: null } },
    select: {
      productId: true,
      branchId: true,
      newPrice: true,
      costSnapshot: true,
      currentPriceSnapshot: true,
      priceSourceSnapshot: true,
      product: { select: { isActive: true } },
    },
  });
  if (lines.length === 0) return false;

  const branchProductPairs = lines.filter((l) => l.branchId).map((l) => ({ branchId: l.branchId as string, productId: l.productId }));
  const policyByKey = await resolvePolicyForProductBatch(branchProductPairs, prisma);

  return lines.some((line) => {
    const policy = line.branchId ? policyByKey.get(`${line.branchId}:${line.productId}`) : undefined;
    const classification = classifyLine(
      {
        newPrice: line.newPrice != null ? Number(line.newPrice) : null,
        costSnapshot: line.costSnapshot != null ? Number(line.costSnapshot) : null,
        currentPriceSnapshot: line.currentPriceSnapshot != null ? Number(line.currentPriceSnapshot) : null,
        priceSourceSnapshot: line.priceSourceSnapshot,
        productIsActive: line.product.isActive,
      },
      { minMarginPercent: policy?.categoryPolicy.minMarginPercent ?? null },
    );
    return classification.status === "PENDING" && classification.warnings.length > 0;
  });
}

/**
 * Lock + CAS de arranque. DRAFT -> APPLYING es el único arranque real;
 * APPLYING se deja pasar de nuevo porque es, por definición, una corrida
 * anterior que no llegó a un estado final (reanudación). APPLIED/PARTIAL/
 * CANCELLED son finales — volver a aplicar ahí es un 409, no un no-op.
 */
export async function beginApplyTx(tx: Prisma.TransactionClient, batchId: string): Promise<PriceUpdateBatch> {
  await tx.$queryRaw`SELECT id FROM "PriceUpdateBatch" WHERE id = ${batchId} FOR UPDATE`;
  const batch = await tx.priceUpdateBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("NOT_FOUND");
  if (batch.status === "APPLIED" || batch.status === "PARTIAL" || batch.status === "CANCELLED") {
    throw new Error("ALREADY_PROCESSED");
  }

  if (batch.status === "DRAFT") {
    const result = await tx.priceUpdateBatch.updateMany({ where: { id: batchId, status: "DRAFT" }, data: { status: "APPLYING" } });
    if (result.count === 0) throw new Error("ALREADY_PROCESSED");
    return { ...batch, status: "APPLYING" };
  }

  return batch; // ya estaba en APPLYING — reanudación
}

/**
 * Cierra la decisión de Bandeja enlazada a una línea, con la MISMA forma
 * que applyOneTrayDecisionTx usa al cerrar (tray-service.ts) — pero SIN
 * llamar a esa función, porque ella misma vuelve a escribir el precio vía
 * applySuggestedPriceTx (lo pisaría dos veces). applyOneTrayDecisionTx no
 * tiene lock propio; acá sí, porque ahora hay dos caminos (Bandeja directa
 * y esta carga) que pueden intentar cerrar la misma decisión.
 */
async function closeLinkedTrayDecisionTx(
  tx: Prisma.TransactionClient,
  decisionId: string,
  actionResult: { branchId: string | null; productId: string; previousPrice: number | null; newPrice: number },
  actorUserId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "BrainDecision" WHERE id = ${decisionId} FOR UPDATE`;
  const decision = await tx.brainDecision.findUnique({ where: { id: decisionId } });
  if (!decision || decision.status !== "OPEN") return; // ya resuelta por otro camino — nada que cerrar

  await tx.brainDecision.update({
    where: { id: decisionId },
    data: {
      status: "EXECUTED",
      resolvedAt: new Date(),
      resolvedByUserId: actorUserId,
      executedEntityType: "Product",
      executedEntityId: actionResult.productId,
      actionResultJson: actionResult as unknown as Prisma.InputJsonValue,
    },
  });
}

type ChunkLine = {
  id: string;
  productId: string;
  branchId: string | null;
  newPrice: Prisma.Decimal | null;
  currentPriceSnapshot: Prisma.Decimal | null;
  trayDecisionId: string | null;
};

/**
 * El cuerpo de UN tanda de hasta LINE_CHUNK_SIZE líneas, en su propia
 * transacción. Lockea TODOS los Product de la tanda primero (ANY+FOR
 * UPDATE, mismo patrón que el checkout batcheado), y recién después relee
 * — así ninguna lectura "fresca" puede quedar vieja contra un escritor
 * concurrente (otra tanda de esta misma carga reanudada, u otro camino que
 * también pase por setBranchPriceTx/setStandardSalePriceTx sobre el mismo
 * producto).
 */
export async function applyLineChunkTx(
  tx: Prisma.TransactionClient,
  batch: Pick<PriceUpdateBatch, "target" | "reason">,
  lineIds: string[],
  actorUserId: string,
): Promise<void> {
  const lines: ChunkLine[] = await tx.priceUpdateLine.findMany({
    where: { id: { in: lineIds }, status: "PENDING" },
    select: { id: true, productId: true, branchId: true, newPrice: true, currentPriceSnapshot: true, trayDecisionId: true },
  });
  if (lines.length === 0) return;

  const productIds = [...new Set(lines.map((l) => l.productId))];
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ANY(ARRAY[${Prisma.join(productIds)}]) ORDER BY id FOR UPDATE`;

  // Relectura DESPUÉS del lock — una reanudación concurrente pudo haber
  // procesado alguna de estas líneas entre la lectura de arriba y acá.
  const freshLines: ChunkLine[] = await tx.priceUpdateLine.findMany({
    where: { id: { in: lineIds }, status: "PENDING" },
    select: { id: true, productId: true, branchId: true, newPrice: true, currentPriceSnapshot: true, trayDecisionId: true },
  });
  if (freshLines.length === 0) return;

  const snapshotsByBranch = new Map<string, Map<string, LineSnapshot>>();
  if (batch.target === "GENERAL") {
    snapshotsByBranch.set("", await snapshotForGeneral(tx, productIds));
  } else {
    const branchIds = [...new Set(freshLines.map((l) => l.branchId).filter((b): b is string => b != null))];
    for (const branchId of branchIds) {
      snapshotsByBranch.set(branchId, await snapshotForBranch(tx, branchId, productIds));
    }
  }

  for (const line of freshLines) {
    const live = snapshotsByBranch.get(line.branchId ?? "")?.get(line.productId);
    const liveCurrentPrice = live?.price ?? null;
    const frozenCurrentPrice = line.currentPriceSnapshot != null ? Number(line.currentPriceSnapshot) : null;

    if (liveCurrentPrice !== frozenCurrentPrice) {
      await tx.priceUpdateLine.updateMany({
        where: { id: line.id, status: "PENDING" },
        data: {
          status: "CONFLICT",
          message: "El precio vigente cambió desde que se armó la carga.",
          currentPriceSnapshot: liveCurrentPrice != null ? new Prisma.Decimal(liveCurrentPrice) : null,
        },
      });
      continue;
    }

    const classification = classifyLine(
      {
        newPrice: line.newPrice != null ? Number(line.newPrice) : null,
        costSnapshot: live?.cost ?? null,
        currentPriceSnapshot: liveCurrentPrice,
        priceSourceSnapshot: live?.priceSource ?? "MISSING",
        productIsActive: live?.productIsActive ?? false,
      },
      { minMarginPercent: null }, // el aviso de margen ya se mostró/aceptó antes de aplicar — acá solo importa bloquear o no
    );

    if (classification.status === "SKIPPED" || classification.status === "BLOCKED") {
      await tx.priceUpdateLine.updateMany({
        where: { id: line.id, status: "PENDING" },
        data: { status: classification.status, message: classification.reason },
      });
      continue;
    }

    // classification.status === "PENDING" acá exige newPrice != null y > 0 (classifyLine lo garantiza).
    const newPriceDecimal = line.newPrice as Prisma.Decimal;
    const previousPrice = batch.target === "GENERAL"
      ? (await setStandardSalePriceTx(tx, { productId: line.productId, newPrice: newPriceDecimal, actorUserId, origin: "carga_precios" })).previousPrice
      : (await setBranchPriceTx(tx, {
          branchId: line.branchId as string,
          productId: line.productId,
          branchPrice: newPriceDecimal,
          exceptionReason: batch.reason,
          priceSource: "MANUAL",
          actorUserId,
          origin: "carga_precios",
        })).previousPrice;

    const applied = await tx.priceUpdateLine.updateMany({
      where: { id: line.id, status: "PENDING" },
      data: { status: "APPLIED", appliedPreviousPrice: previousPrice, appliedAt: new Date(), message: null },
    });
    if (applied.count === 0) continue; // no debería pasar bajo el lock de Product, pero no reescribe un precio ya aplicado

    if (line.trayDecisionId) {
      await closeLinkedTrayDecisionTx(
        tx,
        line.trayDecisionId,
        { branchId: line.branchId, productId: line.productId, previousPrice: previousPrice != null ? Number(previousPrice) : null, newPrice: Number(newPriceDecimal) },
        actorUserId,
      );
    }
  }
}

/**
 * Lock + cierre final. Si ya no está en APPLYING (otra corrida concurrente
 * ya lo cerró) o si todavía quedan líneas PENDING (no debería llamarse
 * así, pero por si acaso), es un no-op — reanudable e idempotente.
 */
export async function finalizeBatchTx(tx: Prisma.TransactionClient, batchId: string, actorUserId: string): Promise<PriceUpdateBatch> {
  await tx.$queryRaw`SELECT id FROM "PriceUpdateBatch" WHERE id = ${batchId} FOR UPDATE`;
  const batch = await tx.priceUpdateBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("NOT_FOUND");
  if (batch.status !== "APPLYING") return batch;

  const pendingLeft = await tx.priceUpdateLine.count({ where: { batchId, status: "PENDING" } });
  if (pendingLeft > 0) return batch;

  const counts = await tx.priceUpdateLine.groupBy({ by: ["status"], where: { batchId }, _count: { _all: true } });
  const countOf = (status: string) => counts.find((c) => c.status === status)?._count._all ?? 0;
  const total = counts.reduce((sum, c) => sum + c._count._all, 0);
  const applied = countOf("APPLIED");
  // total === 0 (todas las líneas se quitaron antes de aplicar) cuenta como APPLIED — no quedó nada parcial.
  const finalStatus: PriceUpdateBatchStatus = applied === total ? "APPLIED" : "PARTIAL";

  const result = await tx.priceUpdateBatch.updateMany({
    where: { id: batchId, status: "APPLYING" },
    data: { status: finalStatus, appliedByUserId: actorUserId, appliedAt: new Date() },
  });
  if (result.count === 0) return batch;

  const totals = { total, applied, blocked: countOf("BLOCKED"), conflict: countOf("CONFLICT"), skipped: countOf("SKIPPED") };
  await tx.auditLog.create({
    data: {
      actorUserId,
      branchId: null,
      module: "pricing",
      action: "PRICE_BATCH_APPLIED",
      entityType: "PriceUpdateBatch",
      entityId: batchId,
      metadataJson: { batchId, code: batch.code, finalStatus, totals } as unknown as Prisma.InputJsonValue,
    },
  });

  return { ...batch, status: finalStatus };
}

/**
 * Orquestador público — NO es una sola transacción (adrede: una carga de
 * miles de líneas no entra en el timeout de Neon). Cada tanda y el cierre
 * final SÍ son atómicos por su cuenta; por eso toda la lógica que de verdad
 * importa (el lock, la re-validación, el CAS) vive en beginApplyTx/
 * applyLineChunkTx/finalizeBatchTx, que son las piezas que este módulo
 * prueba con un tx en memoria. Este wrapper usa el prisma global y no se
 * prueba acá, igual que previewBatch/listBatches en el archivo de Fase 1.
 */
export async function applyBatch(batchId: string, input: ApplyBatchInput): Promise<ApplyBatchResult> {
  const draftBatch = await prisma.priceUpdateBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (draftBatch.status === "DRAFT" && !input.acknowledgeWarnings) {
    const hasWarnings = await batchHasPendingWarnings(batchId);
    if (hasWarnings) throw new Error('VALIDATION_ERROR: Hay avisos sin revisar. Marcá "Revisé los avisos" para continuar.');
  }

  const batch = await prisma.$transaction((tx) => beginApplyTx(tx, batchId));

  while (true) {
    const chunk = await prisma.priceUpdateLine.findMany({
      where: { batchId, status: "PENDING" },
      take: LINE_CHUNK_SIZE,
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (chunk.length === 0) break;
    await prisma.$transaction((tx) => applyLineChunkTx(tx, batch, chunk.map((l) => l.id), input.actorUserId));
  }

  const finalBatch = await prisma.$transaction((tx) => finalizeBatchTx(tx, batchId, input.actorUserId));
  const counts = await prisma.priceUpdateLine.groupBy({ by: ["status"], where: { batchId }, _count: { _all: true } });
  const totals = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));

  return { batchId, status: finalBatch.status, totals };
}
