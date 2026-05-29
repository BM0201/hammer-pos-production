import { InventoryMovementType, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { readCsvContent, readExcelBase64 } from "@/modules/import-excel/excel-reader";
import { generateSkuForProduct, normalizeManualSku } from "@/modules/catalog/sku-generator";
import { createInventoryMovementTx } from "@/modules/inventory/service";

export const INVENTORY_IMPORT_BATCH_STATUS = {
  UPLOADED: "UPLOADED",
  PREVIEWED: "PREVIEWED",
  EXECUTING: "EXECUTING",
  EXECUTED: "EXECUTED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  ROLLED_BACK: "ROLLED_BACK",
} as const;

export const INVENTORY_IMPORT_LINE_STATUS = {
  READY: "READY",
  ERROR: "ERROR",
  EXECUTED: "EXECUTED",
  SKIPPED: "SKIPPED",
  FAILED: "FAILED",
  ROLLED_BACK: "ROLLED_BACK",
} as const;

export type UnifiedImportType =
  | "CATALOG_ONLY"
  | "CATALOG_WITH_INITIAL_STOCK"
  | "CATALOG_WITH_INITIAL_INVENTORY"
  | "INVENTORY_ADD_STOCK"
  | "INVENTORY_ONLY"
  | "INVENTORY_SET_STOCK"
  | "GLOBAL_PRICES_COSTS"
  | "BRANCH_PRICES_COSTS"
  | "PRICES_COSTS_ONLY"
  | "PHYSICAL_COUNT_ADJUSTMENT"
  | "PHYSICAL_COUNT";

type NormalizedImportType =
  | "CATALOG_ONLY"
  | "CATALOG_WITH_INITIAL_STOCK"
  | "INVENTORY_ADD_STOCK"
  | "INVENTORY_SET_STOCK"
  | "GLOBAL_PRICES_COSTS"
  | "BRANCH_PRICES_COSTS"
  | "PHYSICAL_COUNT_ADJUSTMENT";

type DestinationMode = "SINGLE" | "MULTI" | "ALL" | "FILE";

type RawRow = {
  rowNumber: number;
  sku: string;
  name: string;
  categoryCode?: string;
  unit?: string;
  branchCode?: string;
  quantity?: number;
  cost?: number;
  price?: number;
};

export type UnifiedImportItem = {
  rowNumber: number;
  sku: string;
  name: string;
  categoryCode?: string;
  unit?: string;
  action: "Crear producto" | "Actualizar producto" | "Crear inventario inicial" | "Sumar stock" | "Fijar stock" | "Ajustar stock" | "Actualizar costo" | "Actualizar precio" | "Ignorar" | "Error";
  targetBranchId: string;
  targetBranchCode: string;
  targetBranchName: string;
  quantity: number | null;
  unitCost: number | null;
  standardSalePrice: number | null;
  productStatus: "EXISTING" | "NEW";
  status: "READY" | "ERROR";
  messages: string[];
  raw: RawRow;
};

type PreviewInput = {
  actorUserId: string;
  fileContent?: string;
  fileBase64?: string;
  importType: UnifiedImportType;
  destinationMode: DestinationMode;
  branchIds?: string[];
  defaultBranchId?: string;
  createMissingProducts?: boolean;
  defaultCategoryId?: string;
  defaultUnit?: string;
  defaultStandardSalePrice?: number;
};

type ExecuteInput = {
  actorUserId: string;
  batchId: string;
};

class ImportLineExecutionError extends Error {
  constructor(
    message: string,
    readonly lineId: string,
    readonly rowNumber: number,
  ) {
    super(message);
    this.name = "ImportLineExecutionError";
  }
}

function normalizeImportType(importType: UnifiedImportType, destinationMode?: DestinationMode): NormalizedImportType {
  if (importType === "CATALOG_WITH_INITIAL_INVENTORY") return "CATALOG_WITH_INITIAL_STOCK";
  if (importType === "INVENTORY_ONLY") return "INVENTORY_ADD_STOCK";
  if (importType === "PHYSICAL_COUNT") return "PHYSICAL_COUNT_ADJUSTMENT";
  if (importType === "PRICES_COSTS_ONLY") return destinationMode === "FILE" || destinationMode === "SINGLE" || destinationMode === "MULTI" || destinationMode === "ALL"
    ? "BRANCH_PRICES_COSTS"
    : "GLOBAL_PRICES_COSTS";
  return importType;
}

function normalizeHeader(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toNumber(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function readRows(input: Pick<PreviewInput, "fileContent" | "fileBase64">): Promise<RawRow[]> {
  const matrix = input.fileBase64 ? await readExcelBase64(input.fileBase64) : readCsvContent(input.fileContent ?? "");
  if (matrix.length < 2) return [];
  const headers = matrix[0].map(normalizeHeader);
  const index = new Map(headers.map((header, idx) => [header, idx]));
  const pick = (cells: string[], names: string[]) => {
    const idx = names.map((name) => index.get(name)).find((value) => value !== undefined);
    return idx === undefined ? "" : cells[idx]?.trim() ?? "";
  };

  return matrix.slice(1).map((cells, idx) => ({
    rowNumber: idx + 2,
    sku: normalizeManualSku(pick(cells, ["sku", "codigo", "code", "itemcode"])),
    name: pick(cells, ["nombre", "producto", "name", "descripcion"]),
    categoryCode: pick(cells, ["categoria", "categorias", "category", "categories", "grupodeproductos", "grupo"]) || undefined,
    unit: (pick(cells, ["unidad", "unit", "uom", "um"]).trim().toUpperCase()) || undefined,
    branchCode: pick(cells, ["sucursal", "branch", "branchcode"]).toUpperCase() || undefined,
    quantity: toNumber(pick(cells, ["cantidad", "qty", "quantity", "conteo"])),
    cost: toNumber(pick(cells, ["costo", "cost", "costounitario", "unitcost", "costprice"])),
    price: toNumber(pick(cells, ["precio", "price", "standardsaleprice"])),
  })).filter((row) => row.sku || row.name);
}

function fileHash(input: Pick<PreviewInput, "fileContent" | "fileBase64">) {
  return createHash("sha256").update(input.fileBase64 ?? input.fileContent ?? "").digest("hex");
}

function needsBranch(importType: NormalizedImportType) {
  return importType !== "CATALOG_ONLY" && importType !== "GLOBAL_PRICES_COSTS";
}

function changesInventory(importType: NormalizedImportType) {
  return importType === "CATALOG_WITH_INITIAL_STOCK"
    || importType === "INVENTORY_ADD_STOCK"
    || importType === "INVENTORY_SET_STOCK"
    || importType === "PHYSICAL_COUNT_ADJUSTMENT";
}

function messagesJson(messages: string[]): Prisma.InputJsonValue {
  return messages;
}

function rawJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toCsvValue(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildImportErrorsCsv(lines: Array<{ rowNumber: number; sku: string; name: string; targetBranchCode: string | null; messages: string[]; executionMessage?: string | null }>) {
  const rows: Array<Array<string | number>> = [["fila", "sku", "producto", "sucursal", "errores"]];
  for (const line of lines) {
    rows.push([line.rowNumber, line.sku, line.name, line.targetBranchCode ?? "", [...line.messages, line.executionMessage].filter(Boolean).join(" | ")]);
  }
  return rows.map((row) => row.map(toCsvValue).join(",")).join("\n");
}

export function buildImportPreviewCsv(items: UnifiedImportItem[]) {
  const rows: Array<Array<string | number>> = [["fila", "sku", "producto", "accion", "sucursal", "cantidad", "costo", "precio", "estado", "mensajes"]];
  for (const item of items) {
    rows.push([
      item.rowNumber,
      item.sku,
      item.name,
      item.action,
      item.targetBranchCode,
      item.quantity ?? "",
      item.unitCost ?? "",
      item.standardSalePrice ?? "",
      item.status,
      item.messages.join(" | "),
    ]);
  }
  return rows.map((row) => row.map(toCsvValue).join(",")).join("\n");
}

/* ── Analyze: detect missing categories and new products before preview ── */
export async function analyzeUnifiedImport(input: Pick<PreviewInput, "fileContent" | "fileBase64" | "importType" | "destinationMode" | "defaultCategoryId">) {
  const [rows, categories] = await Promise.all([
    readRows(input),
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } }),
  ]);
  const categoryByCode = new Map(categories.map((c) => [c.code.toUpperCase(), c]));
  const categoryByName = new Map(categories.map((c) => [c.name.toUpperCase(), c]));
  const defaultCategory = input.defaultCategoryId ? categories.find((c) => c.id === input.defaultCategoryId) : null;

  // Collect unique category values from file (could be codes or names)
  const fileCategoryCodes = new Set<string>();
  for (const row of rows) {
    if (row.categoryCode?.trim()) fileCategoryCodes.add(row.categoryCode.trim().toUpperCase());
  }

  // Detect which are missing (check by code AND by name)
  const missingCategories: string[] = [];
  for (const code of fileCategoryCodes) {
    if (!categoryByCode.has(code) && !categoryByName.has(code)) missingCategories.push(code);
  }

  // Detect SKUs that don't exist → new products
  const skuList = rows.filter((r) => r.sku).map((r) => r.sku);
  const existingProducts = skuList.length > 0
    ? await prisma.product.findMany({ where: { sku: { in: skuList } }, select: { sku: true } })
    : [];
  const existingSkuSet = new Set(existingProducts.map((p) => p.sku.toUpperCase()));

  let newProductCount = 0;
  let autoSkuCount = 0;
  for (const row of rows) {
    if (row.sku) {
      if (!existingSkuSet.has(row.sku.toUpperCase())) newProductCount++;
    } else if (row.name?.trim()) {
      newProductCount++;
      autoSkuCount++;
    }
  }

  return {
    totalRows: rows.length,
    missingCategories, // category codes not found in system
    newProductCount,
    autoSkuCount,     // products without SKU that will get auto-generated SKU
    defaultCategoryName: defaultCategory?.name ?? null,
    existingCategories: categories.map((c) => ({ code: c.code, name: c.name })),
  };
}

/**
 * Generate a smart short code from a category name.
 * Examples: "CEMENTO" → "CEM", "ALAMBRE" → "ALM", "TORNILLOS" → "TOR", "FERRETERIA" → "FER"
 * If the 3-letter code already exists, tries 4 letters, then adds a number suffix.
 */
export function generateSmartCategoryCode(name: string, existingCodes: Set<string>): string {
  const clean = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!clean) return name.toUpperCase().slice(0, 6);

  // Try 3, 4, 5 letter prefixes
  for (const len of [3, 4, 5]) {
    const candidate = clean.slice(0, len);
    if (candidate.length >= len && !existingCodes.has(candidate)) return candidate;
  }

  // Try with numeric suffix
  const base = clean.slice(0, 3);
  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}${i}`;
    if (!existingCodes.has(candidate)) return candidate;
  }

  return clean.slice(0, 8);
}

/* ── Bulk-create missing categories (called before preview if user confirms) ── */
export async function createMissingCategoriesForImport(categoryCodes: string[], actorUserId: string) {
  const existing = await prisma.category.findMany({ select: { code: true, name: true } });
  const existingCodes = new Set(existing.map((c) => c.code.toUpperCase()));
  const existingNames = new Set(existing.map((c) => c.name.toUpperCase()));
  // Filter out codes whose name already exists as well
  const toCreate = categoryCodes.filter((code) => !existingCodes.has(code.toUpperCase()) && !existingNames.has(code.toUpperCase()));
  const created: Array<{ id: string; code: string; name: string }> = [];
  for (const rawName of toCreate) {
    const smartCode = generateSmartCategoryCode(rawName, existingCodes);
    existingCodes.add(smartCode); // Reserve so next iteration won't collide
    const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();
    const cat = await prisma.category.create({
      data: { code: smartCode, name: displayName },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId,
        module: "catalog",
        action: "CATEGORY_CREATE",
        entityType: "Category",
        entityId: cat.id,
        metadataJson: { source: "IMPORT_AUTO_CREATE", code: cat.code, originalName: rawName },
      },
    });
    created.push({ id: cat.id, code: cat.code, name: cat.name });
  }
  return { created };
}

export async function previewUnifiedCatalogInventoryImport(input: PreviewInput) {
  const importType = normalizeImportType(input.importType, input.destinationMode);
  const [rows, branches, categories] = await Promise.all([
    readRows(input),
    prisma.branch.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } }),
  ]);
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));
  const branchByCode = new Map(branches.map((branch) => [branch.code.toUpperCase(), branch]));
  const categoryByCode = new Map(categories.map((category) => [category.code.toUpperCase(), category]));
  const categoryByName = new Map(categories.map((category) => [category.name.toUpperCase(), category]));
  const defaultCategory = input.defaultCategoryId ? categories.find((category) => category.id === input.defaultCategoryId) : null;
  const reservedSkus = new Set<string>();
  const skuByRowNumber = new Map<number, string>();

  for (const row of rows) {
    let sku = "";
    if (row.sku) {
      // Manual SKU already normalized at read time — skip DB call
      sku = row.sku;
    } else if (row.name.trim()) {
      const categoryName = row.categoryCode ? (categoryByCode.get(row.categoryCode.toUpperCase()) ?? categoryByName.get(row.categoryCode.toUpperCase()))?.name ?? row.categoryCode : defaultCategory?.name ?? null;
      sku = await generateSkuForProduct(prisma, {
        productName: row.name,
        categoryName,
        sku: row.sku,
      }, reservedSkus);
    }
    reservedSkus.add(sku);
    skuByRowNumber.set(row.rowNumber, sku);
  }

  const skuList = Array.from(new Set(skuByRowNumber.values()));
  const products = await prisma.product.findMany({ where: { sku: { in: skuList } }, select: { id: true, sku: true } });
  const existingSkus = new Set(products.map((product) => product.sku.toUpperCase()));

  const resolveBranches = (row: RawRow) => {
    if (!needsBranch(importType)) return [null];
    if (input.destinationMode === "ALL") return branches;
    if (input.destinationMode === "MULTI") return (input.branchIds ?? []).map((id) => branchById.get(id)).filter(Boolean);
    if (input.destinationMode === "FILE") return row.branchCode ? [branchByCode.get(row.branchCode)].filter(Boolean) : [];
    return input.defaultBranchId ? [branchById.get(input.defaultBranchId)].filter(Boolean) : [];
  };

  const items: UnifiedImportItem[] = [];
  for (const row of rows) {
    const rowSku = skuByRowNumber.get(row.rowNumber) ?? row.sku;
    const targets = resolveBranches(row);
    if (targets.length === 0) {
      items.push({
        rowNumber: row.rowNumber,
        sku: rowSku,
        name: row.name,
        categoryCode: row.categoryCode,
        unit: row.unit,
        action: "Error",
        targetBranchId: "",
        targetBranchCode: row.branchCode ?? "",
        targetBranchName: "Sin sucursal valida",
        quantity: row.quantity ?? null,
        unitCost: row.cost ?? null,
        standardSalePrice: row.price ?? null,
        productStatus: existingSkus.has(rowSku) ? "EXISTING" : "NEW",
        status: "ERROR",
        messages: ["No se pudo resolver la sucursal."],
        raw: row,
      });
      continue;
    }

    for (const branch of targets) {
      const exists = existingSkus.has(rowSku);
      const messages: string[] = [];
      if (!exists && !row.name) messages.push("Producto nuevo requiere nombre.");
      if (!exists && importType === "INVENTORY_ADD_STOCK") messages.push("Inventario requiere SKU existente o usa Catalogo + inventario inicial.");
      if (changesInventory(importType) && (row.quantity === undefined || row.quantity < 0)) messages.push("Cantidad invalida.");
      if (row.cost !== undefined && row.cost < 0) messages.push("Costo invalido.");
      if (row.price !== undefined && row.price < 0) messages.push("Precio invalido.");
      if ((importType === "CATALOG_WITH_INITIAL_STOCK" || importType === "INVENTORY_ADD_STOCK") && row.cost !== undefined && row.cost <= 0 && (row.quantity ?? 0) > 0) {
        messages.push("Entradas de inventario requieren costo positivo.");
      }

      const action = (() => {
        if (messages.length) return "Error";
        if (importType === "CATALOG_ONLY") return exists ? "Actualizar producto" : "Crear producto";
        if (importType === "CATALOG_WITH_INITIAL_STOCK") return exists ? "Crear inventario inicial" : "Crear producto";
        if (importType === "INVENTORY_ADD_STOCK") return "Sumar stock";
        if (importType === "INVENTORY_SET_STOCK") return "Fijar stock";
        if (importType === "PHYSICAL_COUNT_ADJUSTMENT") return "Ajustar stock";
        if (importType === "GLOBAL_PRICES_COSTS" || importType === "BRANCH_PRICES_COSTS") {
          if (row.price !== undefined && row.cost !== undefined) return "Actualizar precio";
          if (row.price !== undefined) return "Actualizar precio";
          if (row.cost !== undefined) return "Actualizar costo";
        }
        return "Ignorar";
      })();

      items.push({
        rowNumber: row.rowNumber,
        sku: rowSku,
        name: row.name,
        categoryCode: row.categoryCode,
        unit: row.unit,
        action,
        targetBranchId: branch?.id ?? "",
        targetBranchCode: branch?.code ?? "GLOBAL",
        targetBranchName: branch?.name ?? "Catalogo maestro",
        quantity: row.quantity ?? null,
        unitCost: row.cost ?? null,
        standardSalePrice: row.price ?? null,
        productStatus: exists ? "EXISTING" : "NEW",
        status: messages.length ? "ERROR" : "READY",
        messages,
        raw: row,
      });
    }
  }

  const summary = {
    parsedRows: rows.length,
    expandedRows: items.length,
    existingProducts: items.filter((item) => item.productStatus === "EXISTING").length,
    newProducts: items.filter((item) => item.productStatus === "NEW").length,
    readyRows: items.filter((item) => item.status === "READY").length,
    errorRows: items.filter((item) => item.status === "ERROR").length,
    ready: items.filter((item) => item.status === "READY").length,
    errors: items.filter((item) => item.status === "ERROR").length,
    status: INVENTORY_IMPORT_BATCH_STATUS.PREVIEWED,
  };
  const previewCsv = buildImportPreviewCsv(items);

  const batch = await prisma.inventoryImportBatch.create({
    data: {
      importType,
      destinationMode: input.destinationMode,
      defaultBranchId: input.defaultBranchId ?? null,
      fileHash: fileHash(input),
      summaryJson: rawJson(summary),
      rawJson: rawJson({
        originalImportType: input.importType,
        importType,
        destinationMode: input.destinationMode,
        branchIds: input.branchIds ?? [],
        defaultBranchId: input.defaultBranchId ?? null,
        fileHash: fileHash(input),
      }),
      status: INVENTORY_IMPORT_BATCH_STATUS.PREVIEWED,
      createdByUserId: input.actorUserId,
      createMissingProducts: Boolean(input.createMissingProducts),
      defaultCategoryId: input.defaultCategoryId ?? null,
      defaultUnit: input.defaultUnit?.trim() || "UN",
      defaultStandardSalePrice: input.defaultStandardSalePrice === undefined ? null : new Prisma.Decimal(input.defaultStandardSalePrice),
      lines: {
        create: items.map((item) => ({
          rowNumber: item.rowNumber,
          sku: item.sku,
          name: item.name,
          categoryCode: item.categoryCode ?? null,
          unit: item.unit ?? null,
          action: item.action,
          targetBranchId: item.targetBranchId || null,
          targetBranchCode: item.targetBranchCode || null,
          targetBranchName: item.targetBranchName || null,
          quantity: item.quantity === null ? null : new Prisma.Decimal(item.quantity),
          unitCost: item.unitCost === null ? null : new Prisma.Decimal(item.unitCost),
          standardSalePrice: item.standardSalePrice === null ? null : new Prisma.Decimal(item.standardSalePrice),
          productStatus: item.productStatus,
          status: item.status,
          messagesJson: messagesJson(item.messages),
          rawJson: rawJson(item.raw),
        })),
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      module: "catalog-inventory",
      action: "INVENTORY_IMPORT_PREVIEWED",
      entityType: "InventoryImportBatch",
      entityId: batch.id,
      metadataJson: rawJson(summary),
    },
  });

  return {
    batchId: batch.id,
    status: INVENTORY_IMPORT_BATCH_STATUS.PREVIEWED,
    items,
    summary,
    previewCsv,
  };
}

function assertPositiveQuantity(value: number | null, line: { id: string; rowNumber: number }) {
  if (value === null || !Number.isFinite(value) || value < 0) throw new ImportLineExecutionError("Cantidad invalida.", line.id, line.rowNumber);
}

function assertNonNegative(value: number | null, label: string, line: { id: string; rowNumber: number }) {
  if (value !== null && (!Number.isFinite(value) || value < 0)) throw new ImportLineExecutionError(`${label} invalido.`, line.id, line.rowNumber);
}

async function upsertBranchSettingTx(tx: Prisma.TransactionClient, input: {
  branchId: string;
  productId: string;
  branchCost: number | null;
  branchPrice: number | null;
  actorUserId: string;
}) {
  const data = {
    branchCost: input.branchCost === null ? undefined : new Prisma.Decimal(input.branchCost),
    branchPrice: input.branchPrice === null ? undefined : new Prisma.Decimal(input.branchPrice),
  };
  const setting = await tx.branchProductSetting.upsert({
    where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
    create: { branchId: input.branchId, productId: input.productId, ...data },
    update: data,
  });
  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "catalog-inventory",
      action: "BRANCH_PRODUCT_SETTING_UPSERT",
      entityType: "BranchProductSetting",
      entityId: setting.id,
      metadataJson: { productId: input.productId, branchCost: input.branchCost, branchPrice: input.branchPrice },
    },
  });
}

async function productForLineTx(tx: Prisma.TransactionClient, line: {
  id: string;
  rowNumber: number;
  sku: string;
  name: string;
  categoryCode: string | null;
  unit: string | null;
  standardSalePrice: Prisma.Decimal | null;
}, batch: {
  createMissingProducts: boolean;
  defaultCategoryId: string | null;
  defaultUnit: string | null;
  defaultStandardSalePrice: Prisma.Decimal | null;
}, actorUserId: string, result: ImportResult) {
  const sku = normalizeManualSku(line.sku);
  let product = await tx.product.findUnique({ where: { sku }, select: { id: true, sku: true } });
  if (product) return product;

  if (!batch.createMissingProducts) {
    throw new ImportLineExecutionError("Producto no existe y createMissingProducts esta deshabilitado.", line.id, line.rowNumber);
  }
  if (!batch.defaultCategoryId) {
    throw new ImportLineExecutionError("Categoria default requerida para crear productos.", line.id, line.rowNumber);
  }

  const category = await tx.category.findUnique({ where: { id: batch.defaultCategoryId }, select: { id: true, isActive: true } });
  if (!category?.isActive) throw new ImportLineExecutionError("Categoria default invalida o inactiva.", line.id, line.rowNumber);

  const created = await tx.product.create({
    data: {
      sku,
      name: line.name.trim(),
      categoryId: batch.defaultCategoryId,
      unit: line.unit?.trim() || batch.defaultUnit || "UN",
      allowsFraction: false,
      isTimber: false,
      standardSalePrice: line.standardSalePrice ?? batch.defaultStandardSalePrice ?? new Prisma.Decimal(1),
      description: "Creado por importacion de catalogo e inventario",
    },
    select: { id: true, sku: true },
  });
  await tx.auditLog.create({
    data: {
      actorUserId,
      module: "catalog",
      action: "PRODUCT_CREATE",
      entityType: "Product",
      entityId: created.id,
      metadataJson: { source: "IMPORT_BATCH", sku },
    },
  });
  result.createdProducts += 1;
  return created;
}

type ImportResult = {
  executedLines: number;
  skippedLines: number;
  failedLines: number;
  createdProducts: number;
  updatedProducts: number;
  inventoryMovements: number;
  priceUpdates: number;
  costUpdates: number;
};

const IMPORT_CHUNK_SIZE = 50;
const IMPORT_TX_TIMEOUT = 30_000;
const IMPORT_TX_MAX_WAIT = 10_000;

export async function executeUnifiedCatalogInventoryImport(input: ExecuteInput) {
  const now = new Date();
  const result: ImportResult = {
    executedLines: 0,
    skippedLines: 0,
    failedLines: 0,
    createdProducts: 0,
    updatedProducts: 0,
    inventoryMovements: 0,
    priceUpdates: 0,
    costUpdates: 0,
  };

  try {
    // Phase 1: Lock batch and load lines in a short transaction
    const { batch, lines } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM "InventoryImportBatch"
        WHERE id = ${input.batchId}
        FOR UPDATE
      `;

      const b = await tx.inventoryImportBatch.findUnique({
        where: { id: input.batchId },
        include: { lines: { where: { status: INVENTORY_IMPORT_LINE_STATUS.READY }, orderBy: { rowNumber: "asc" } } },
      });
      if (!b) throw new Error("NOT_FOUND: preview de importacion no encontrado");
      if (b.status === INVENTORY_IMPORT_BATCH_STATUS.EXECUTED) throw new Error("VALIDATION_ERROR: este batch ya fue ejecutado");
      if (b.status === INVENTORY_IMPORT_BATCH_STATUS.EXECUTING) throw new Error("VALIDATION_ERROR: este batch ya esta en ejecucion");
      if (b.status !== INVENTORY_IMPORT_BATCH_STATUS.PREVIEWED) throw new Error("VALIDATION_ERROR: solo se pueden ejecutar batches PREVIEWED");
      if (b.lines.length === 0) throw new Error("VALIDATION_ERROR: no hay lineas READY para ejecutar");

      await tx.inventoryImportBatch.update({
        where: { id: b.id },
        data: { status: INVENTORY_IMPORT_BATCH_STATUS.EXECUTING, executedByUserId: input.actorUserId },
      });

      return { batch: b, lines: b.lines };
    }, { timeout: IMPORT_TX_TIMEOUT, maxWait: IMPORT_TX_MAX_WAIT });

    // Pre-load shared data once (outside transactions)
    const categories = await prisma.category.findMany({ select: { id: true, code: true, name: true, isActive: true } });
    const categoryByCode = new Map(categories.map((category) => [category.code.toUpperCase(), category]));
    const categoryByNameExec = new Map(categories.map((category) => [category.name.toUpperCase(), category]));
    const importType = normalizeImportType(batch.importType as UnifiedImportType, batch.destinationMode as DestinationMode);

    // Phase 2: Process lines in chunks
    const chunks: typeof lines[] = [];
    for (let i = 0; i < lines.length; i += IMPORT_CHUNK_SIZE) {
      chunks.push(lines.slice(i, i + IMPORT_CHUNK_SIZE));
    }

    for (const chunk of chunks) {
      await prisma.$transaction(async (tx) => {
        for (const line of chunk) {
          const quantity = line.quantity === null ? null : Number(line.quantity);
          const unitCost = line.unitCost === null ? null : Number(line.unitCost);
          const standardSalePrice = line.standardSalePrice === null ? null : Number(line.standardSalePrice);
          assertPositiveQuantity(quantity, line);
          assertNonNegative(unitCost, "Costo", line);
          assertNonNegative(standardSalePrice, "Precio", line);

          let product = await tx.product.findUnique({ where: { sku: normalizeManualSku(line.sku) }, select: { id: true, sku: true } });
          const needsProduct = importType !== "CATALOG_ONLY" || line.productStatus === "EXISTING";
          if (!product && (needsProduct || batch.createMissingProducts)) {
            product = await productForLineTx(tx, line, batch, input.actorUserId, result);
          }
          if (!product) throw new ImportLineExecutionError("Producto no encontrado.", line.id, line.rowNumber);

          if (importType === "CATALOG_ONLY" || importType === "CATALOG_WITH_INITIAL_STOCK") {
            const category = line.categoryCode ? (categoryByCode.get(line.categoryCode.toUpperCase()) ?? categoryByNameExec.get(line.categoryCode.toUpperCase())) : null;
            await tx.product.update({
              where: { id: product.id },
              data: {
                name: line.name.trim() || undefined,
                unit: line.unit?.trim() || undefined,
                categoryId: category?.isActive ? category.id : undefined,
                standardSalePrice: standardSalePrice === null ? undefined : new Prisma.Decimal(standardSalePrice),
              },
            });
            await tx.auditLog.create({
              data: {
                actorUserId: input.actorUserId,
                module: "catalog",
                action: "PRODUCT_UPDATE",
                entityType: "Product",
                entityId: product.id,
                metadataJson: { source: "IMPORT_BATCH", batchId: batch.id, rowNumber: line.rowNumber },
              },
            });
            result.updatedProducts += 1;
            if (standardSalePrice !== null) result.priceUpdates += 1;
          }

          if ((importType === "GLOBAL_PRICES_COSTS" || importType === "BRANCH_PRICES_COSTS") && standardSalePrice !== null && !line.targetBranchId) {
            await tx.product.update({ where: { id: product.id }, data: { standardSalePrice: new Prisma.Decimal(standardSalePrice) } });
            await tx.auditLog.create({
              data: {
                actorUserId: input.actorUserId,
                module: "catalog",
                action: "PRODUCT_UPDATE",
                entityType: "Product",
                entityId: product.id,
                metadataJson: { source: "IMPORT_BATCH", batchId: batch.id, standardSalePrice },
              },
            });
            result.priceUpdates += 1;
          }

          if ((importType === "BRANCH_PRICES_COSTS" || importType === "GLOBAL_PRICES_COSTS") && line.targetBranchId && (unitCost !== null || standardSalePrice !== null)) {
            await upsertBranchSettingTx(tx, {
              branchId: line.targetBranchId,
              productId: product.id,
              branchCost: unitCost,
              branchPrice: standardSalePrice,
              actorUserId: input.actorUserId,
            });
            if (unitCost !== null) result.costUpdates += 1;
            if (standardSalePrice !== null) result.priceUpdates += 1;
          }

          if (changesInventory(importType)) {
            if (!line.targetBranchId) throw new ImportLineExecutionError("Sucursal requerida para movimiento de inventario.", line.id, line.rowNumber);
            if (quantity === null) throw new ImportLineExecutionError("Cantidad requerida para inventario.", line.id, line.rowNumber);

            let movementQuantity = quantity;
            let movementType: InventoryMovementType = InventoryMovementType.ADJUSTMENT_IN;
            if (importType === "INVENTORY_SET_STOCK" || importType === "PHYSICAL_COUNT_ADJUSTMENT") {
              const balance = await tx.inventoryBalance.findUnique({
                where: { branchId_productId: { branchId: line.targetBranchId, productId: product.id } },
              });
              const current = Number(balance?.quantityOnHand ?? 0);
              const delta = quantity - current;
              if (delta === 0) {
                await tx.inventoryImportLine.update({
                  where: { id: line.id },
                  data: { status: INVENTORY_IMPORT_LINE_STATUS.SKIPPED, executionStatus: INVENTORY_IMPORT_LINE_STATUS.SKIPPED, executionMessage: "Stock sin cambios.", executedAt: now, updatedProductId: product.id },
                });
                result.skippedLines += 1;
                continue;
              }
              movementType = delta > 0 ? InventoryMovementType.ADJUSTMENT_IN : InventoryMovementType.ADJUSTMENT_OUT;
              movementQuantity = Math.abs(delta);
            }

            const movementResult = await createInventoryMovementTx(tx, {
              actorUserId: input.actorUserId,
              branchId: line.targetBranchId,
              productId: product.id,
              movementType,
              quantity: movementQuantity,
              unitCost: unitCost ?? 0,
              referenceType: "IMPORT_BATCH",
              referenceId: batch.id,
              notes: `Importacion Catalogo e Inventario batch ${batch.id} fila ${line.rowNumber}`,
            });
            await tx.auditLog.create({
              data: {
                actorUserId: input.actorUserId,
                branchId: line.targetBranchId,
                module: "catalog-inventory",
                action: "INVENTORY_IMPORT_LINE_EXECUTED",
                entityType: "InventoryImportLine",
                entityId: line.id,
                metadataJson: {
                  batchId: batch.id,
                  movementId: movementResult.movement.id,
                  balanceAfter: movementResult.balance.quantityOnHand.toString(),
                },
              },
            });
            result.inventoryMovements += 1;
          }

          await tx.inventoryImportLine.update({
            where: { id: line.id },
            data: {
              status: INVENTORY_IMPORT_LINE_STATUS.EXECUTED,
              executionStatus: INVENTORY_IMPORT_LINE_STATUS.EXECUTED,
              updatedProductId: product.id,
              executedAt: now,
            },
          });
          result.executedLines += 1;
        }
      }, { timeout: IMPORT_TX_TIMEOUT, maxWait: IMPORT_TX_MAX_WAIT });
    }

    // Phase 3: Finalize batch
    const finalSummary = { ...result, status: INVENTORY_IMPORT_BATCH_STATUS.EXECUTED };
    const executed = await prisma.inventoryImportBatch.update({
      where: { id: batch.id },
      data: {
        status: INVENTORY_IMPORT_BATCH_STATUS.EXECUTED,
        executedByUserId: input.actorUserId,
        executedAt: now,
        summaryJson: rawJson(finalSummary),
        resultJson: rawJson(finalSummary),
      },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        module: "catalog-inventory",
        action: "INVENTORY_IMPORT_EXECUTED",
        entityType: "InventoryImportBatch",
        entityId: batch.id,
        metadataJson: rawJson(finalSummary),
      },
    });

    return { ...result, batchId: executed.id, status: executed.status, errorCsv: "" };
  } catch (error) {
    const failedLine = error instanceof ImportLineExecutionError ? error : null;
    result.failedLines = failedLine ? 1 : 0;
    await prisma.$transaction(async (tx) => {
      await tx.inventoryImportBatch.updateMany({
        where: { id: input.batchId, status: { in: [INVENTORY_IMPORT_BATCH_STATUS.EXECUTING, INVENTORY_IMPORT_BATCH_STATUS.PREVIEWED] } },
        data: {
          status: INVENTORY_IMPORT_BATCH_STATUS.FAILED,
          executedByUserId: input.actorUserId,
          executedAt: new Date(),
          resultJson: rawJson({ ...result, status: INVENTORY_IMPORT_BATCH_STATUS.FAILED, error: error instanceof Error ? error.message : String(error) }),
        },
      });
      if (failedLine) {
        await tx.inventoryImportLine.update({
          where: { id: failedLine.lineId },
          data: {
            status: INVENTORY_IMPORT_LINE_STATUS.FAILED,
            executionStatus: INVENTORY_IMPORT_LINE_STATUS.FAILED,
            executionMessage: failedLine.message,
            executedAt: new Date(),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          module: "catalog-inventory",
          action: "INVENTORY_IMPORT_FAILED",
          entityType: "InventoryImportBatch",
          entityId: input.batchId,
          metadataJson: {
            error: error instanceof Error ? error.message : String(error),
            failedRowNumber: failedLine?.rowNumber ?? null,
          },
        },
      });
    });
    throw error;
  }
}
