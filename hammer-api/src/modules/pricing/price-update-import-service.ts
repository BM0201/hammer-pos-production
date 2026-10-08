import { createHash } from "node:crypto";
import type { PriceUpdateBatchTarget } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readCsvContent, readExcelBase64 } from "@/modules/import-excel/excel-reader";
import { normalizeManualSku } from "@/modules/catalog/sku-generator";
import { createDraft, type CreateDraftItem } from "@/modules/pricing/price-update-batch-service";
import { parsePriceImportMatrix, MAX_PRICE_IMPORT_ROWS } from "@/modules/pricing/price-import-parser";

/**
 * prompt-carga-precios.md Fase 4 — "desde archivo" es un adaptador delante
 * de createDraft (Fase 1): parsea el archivo, resuelve cada fila a un
 * productId (SKU exacto primero, código de barras después — AL REVÉS que
 * findProductByCode, que es para el lector de la Fase de alta rápida y
 * busca barcode primero; acá el usuario typeó un SKU a mano, así que
 * normalizeManualSku, no el trim plano de un scanner), descarta
 * desconocidos/duplicados con detalle, y crea el MISMO tipo de borrador que
 * "Nueva carga" manual — nunca aplica nada él mismo.
 */

export type PriceImportInput = {
  fileBase64?: string;
  fileContent?: string;
  target: PriceUpdateBatchTarget;
  branchIds: string[];
  reason: string;
  actorUserId: string;
};

export type PriceImportResult = {
  batchId: string;
  code: string;
  totalRows: number;
  matched: number;
  unmatched: Array<{ rowNumber: number; sku: string; barcode: string }>;
  duplicates: Array<{ rowNumber: number; sku: string }>;
  /** Código de una carga previa (no cancelada) con el MISMO archivo — aviso, nunca bloquea. */
  duplicateOfBatchCode: string | null;
};

export async function importPriceUpdateDraft(input: PriceImportInput): Promise<PriceImportResult> {
  const matrix = input.fileBase64 ? await readExcelBase64(input.fileBase64) : readCsvContent(input.fileContent ?? "");
  const dataRowCount = Math.max(0, matrix.length - 1);
  if (dataRowCount > MAX_PRICE_IMPORT_ROWS) {
    throw new Error(`VALIDATION_ERROR: El archivo tiene ${dataRowCount} filas — el máximo por carga es ${MAX_PRICE_IMPORT_ROWS}.`);
  }

  const parsedRows = parsePriceImportMatrix(matrix);
  if (parsedRows.length === 0) {
    throw new Error("VALIDATION_ERROR: El archivo no tiene filas con SKU o código de barras.");
  }

  const normalizedSkus = [...new Set(parsedRows.map((r) => (r.sku ? normalizeManualSku(r.sku) : "")).filter(Boolean))];
  const barcodes = [...new Set(parsedRows.map((r) => r.barcode.trim()).filter(Boolean))];

  const [bySku, byBarcode] = await Promise.all([
    normalizedSkus.length > 0 ? prisma.product.findMany({ where: { sku: { in: normalizedSkus } }, select: { id: true, sku: true } }) : Promise.resolve([]),
    barcodes.length > 0 ? prisma.product.findMany({ where: { barcode: { in: barcodes } }, select: { id: true, barcode: true } }) : Promise.resolve([]),
  ]);
  const productIdBySku = new Map(bySku.map((p) => [p.sku, p.id]));
  const productIdByBarcode = new Map(byBarcode.filter((p): p is { id: string; barcode: string } => p.barcode != null).map((p) => [p.barcode, p.id]));

  const items: CreateDraftItem[] = [];
  const seenProductIds = new Set<string>();
  const unmatched: PriceImportResult["unmatched"] = [];
  const duplicates: PriceImportResult["duplicates"] = [];

  for (const row of parsedRows) {
    const normalizedSku = row.sku ? normalizeManualSku(row.sku) : "";
    const normalizedBarcode = row.barcode.trim();
    const productId = (normalizedSku && productIdBySku.get(normalizedSku)) || (normalizedBarcode && productIdByBarcode.get(normalizedBarcode)) || null;

    if (!productId) {
      unmatched.push({ rowNumber: row.rowNumber, sku: row.sku, barcode: row.barcode });
      continue;
    }
    if (seenProductIds.has(productId)) {
      duplicates.push({ rowNumber: row.rowNumber, sku: row.sku });
      continue;
    }
    seenProductIds.add(productId);
    items.push({ productId, newPrice: row.newPrice });
  }

  if (items.length === 0) {
    throw new Error("VALIDATION_ERROR: Ningún producto del archivo coincide con el catálogo (por SKU o código de barras).");
  }

  const fileHash = createHash("sha256").update(input.fileBase64 ?? input.fileContent ?? "").digest("hex");
  const duplicateBatch = await prisma.priceUpdateBatch.findFirst({
    where: { fileHash, status: { not: "CANCELLED" } },
    select: { code: true },
    orderBy: { createdAt: "desc" },
  });

  const { batchId, code } = await createDraft({
    target: input.target,
    branchIds: input.branchIds,
    reason: input.reason,
    source: "FILE",
    items,
    actorUserId: input.actorUserId,
  });
  await prisma.priceUpdateBatch.update({ where: { id: batchId }, data: { fileHash } });

  return {
    batchId,
    code,
    totalRows: parsedRows.length,
    matched: items.length,
    unmatched,
    duplicates,
    duplicateOfBatchCode: duplicateBatch?.code ?? null,
  };
}
