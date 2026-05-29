import { prisma } from "@/lib/prisma";
import { createInventoryMovement } from "@/modules/inventory/service";
import { createProduct } from "@/modules/catalog/service";
import { generateSkuForProduct, normalizeManualSku } from "@/modules/catalog/sku-generator";
import { readExcelBase64 } from "@/modules/import-excel/excel-reader";

export type ImportDestinationMode = "SINGLE" | "MULTI" | "ALL" | "FILE";
export type CatalogInventoryImportType =
  | "CATALOG_ONLY"
  | "CATALOG_WITH_INITIAL_INVENTORY"
  | "INVENTORY_ONLY"
  | "PRICES_COSTS_ONLY"
  | "PHYSICAL_COUNT";

type RawImportRow = {
  rowNumber: number;
  sourceRowIndex: number;
  sku: string;
  name: string;
  quantity: number;
  unitCost: number;
  standardSalePrice?: number;
  branchCode?: string;
};

export type InventoryImportPreviewItem = {
  rowNumber: number;
  sku: string;
  name: string;
  quantity: number;
  unitCost: number;
  standardSalePrice?: number;
  targetBranchId: string;
  targetBranchCode: string;
  targetBranchName: string;
  productStatus: "EXISTING" | "NEW";
  action: "CREATE_PRODUCT" | "UPDATE_PRODUCT" | "CREATE_INITIAL_INVENTORY" | "ADJUST_STOCK" | "UPDATE_COST" | "UPDATE_PRICE" | "IGNORE" | "ERROR" | "IMPORT_EXISTING" | "CREATE_AND_IMPORT";
  status: "READY" | "ERROR";
  messages: string[];
};

type PreviewInput = {
  fileContent?: string;
  fileBase64?: string;
  fileName?: string;
  destinationMode: ImportDestinationMode;
  importType?: CatalogInventoryImportType;
  branchIds?: string[];
  defaultBranchId?: string;
};

type ExecuteInput = {
  actorUserId: string;
  items: InventoryImportPreviewItem[];
  importType?: CatalogInventoryImportType;
  createMissingProducts: boolean;
  defaultCategoryId?: string;
  defaultUnit?: string;
  defaultStandardSalePrice?: number;
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value !== "string") return Number.NaN;
  const cleaned = value.trim().replace(/\s+/g, "").replace(",", ".");
  if (!cleaned) return Number.NaN;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      const isEscapedQuote = inQuotes && line[i + 1] === "\"";
      if (isEscapedQuote) {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current.trim());
  return result;
}

export function parseInventoryImportFile(content: string): RawImportRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) return [];

  const delimiter = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const headers = parseCsvLine(lines[0], delimiter).map(normalizeHeader);
  const headerIndex = new Map(headers.map((header, index) => [header, index]));

  const get = (cells: string[], aliases: string[]) => {
    const idx = aliases.map((alias) => headerIndex.get(alias)).find((value) => value !== undefined);
    return idx === undefined ? "" : cells[idx] ?? "";
  };

  const rows: RawImportRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i], delimiter);
    rows.push({
      rowNumber: i + 1,
      sourceRowIndex: i + 1,
      sku: normalizeManualSku(get(cells, ["sku", "codigo", "código"])),
      name: get(cells, ["nombre", "name", "productname"]),
      quantity: Number(get(cells, ["cantidad", "qty", "quantity"])),
      unitCost: Number(get(cells, ["costounitario", "unitcost", "costo", "cost"])),
      standardSalePrice: Number(get(cells, ["precio", "price", "standardsaleprice"])) || undefined,
      branchCode: get(cells, ["sucursal", "branch", "branchcode"]) || undefined,
    });
  }

  return rows;
}

type HeaderMapping = {
  sku?: number;
  name?: number;
  quantity?: number;
  unitCost?: number;
  fallbackUnitCost?: number;
  standardSalePrice?: number;
  branchCode?: number;
  groupHint?: number;
  total?: number;
  taxableBase?: number;
};

type ParseResult = {
  rows: RawImportRow[];
  globalWarnings: string[];
  blocksExecution: boolean;
  hasSkuColumn: boolean;
  hasNameColumn: boolean;
};

function resolveHeaderMapping(rawHeaders: string[]): HeaderMapping {
  const normalizedHeaders = rawHeaders.map((header) => normalizeHeader(normalizeText(header)));
  const indexByHeader = new Map(normalizedHeaders.map((header, index) => [header, index]));
  const pick = (...aliases: string[]) => aliases.map((alias) => indexByHeader.get(alias)).find((idx) => idx !== undefined);
  return {
    sku: pick("sku", "codigo", "code", "productcode", "itemcode"),
    name: pick("nombre", "name", "productname", "producto", "descripcion", "description"),
    quantity: pick("cantidad", "qty", "qty.", "quantity", "cant"),
    unitCost: pick("costounitario", "unitcost", "costo", "cost", "costprice"),
    fallbackUnitCost: pick("costbeftax", "costincltax"),
    standardSalePrice: pick("precio", "price", "standardsaleprice"),
    branchCode: pick("sucursal", "branch", "branchcode"),
    groupHint: pick("grupodeproductos", "grupo", "group", "category"),
    total: pick("total"),
    taxableBase: pick("baseimponible"),
  };
}

function parseRowsFromMatrix(matrix: string[][]): ParseResult {
  if (matrix.length < 2) {
    return { rows: [], globalWarnings: ["El archivo no contiene filas de datos."], blocksExecution: true, hasSkuColumn: false, hasNameColumn: false };
  }

  const headers = matrix[0] ?? [];
  const mapping = resolveHeaderMapping(headers);
  const rows: RawImportRow[] = [];
  let quantityZeroCount = 0;
  let costZeroCount = 0;
  let quantityFiniteCount = 0;
  let costFiniteCount = 0;

  const readCell = (cells: string[], index?: number) => (index === undefined ? "" : (cells[index] ?? "").trim());

  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    const cells = matrix[rowIndex] ?? [];
    if (cells.every((cell) => !cell.trim())) continue;

    const quantity = toNumber(readCell(cells, mapping.quantity));
    const baseCost = toNumber(readCell(cells, mapping.unitCost));
    const fallbackCost = toNumber(readCell(cells, mapping.fallbackUnitCost));
    const unitCost = Number.isFinite(baseCost) ? baseCost : fallbackCost;

    if (Number.isFinite(quantity)) {
      quantityFiniteCount += 1;
      if (quantity === 0) quantityZeroCount += 1;
    }
    if (Number.isFinite(unitCost)) {
      costFiniteCount += 1;
      if (unitCost === 0) costZeroCount += 1;
    }

    rows.push({
      rowNumber: rowIndex + 1,
      sourceRowIndex: rowIndex + 1,
      sku: normalizeManualSku(readCell(cells, mapping.sku)),
      name: readCell(cells, mapping.name),
      quantity,
      unitCost,
      standardSalePrice: toNumber(readCell(cells, mapping.standardSalePrice)) || undefined,
      branchCode: readCell(cells, mapping.branchCode) || undefined,
    });
  }

  const globalWarnings: string[] = [];
  const hasSkuColumn = mapping.sku !== undefined;
  const hasNameColumn = mapping.name !== undefined;
  const hasQuantityColumn = mapping.quantity !== undefined;
  const hasCostColumn = mapping.unitCost !== undefined || mapping.fallbackUnitCost !== undefined;

  if (!hasSkuColumn) globalWarnings.push("No se detectó columna SKU.");
  if (!hasNameColumn) globalWarnings.push("No se detectó columna nombre de producto.");
  if (!hasQuantityColumn) globalWarnings.push("No se detectó columna de cantidad.");
  if (!hasCostColumn) globalWarnings.push("No se detectó columna de costo.");
  if (quantityFiniteCount > 0 && quantityZeroCount === quantityFiniteCount) globalWarnings.push("100% de las cantidades vienen en 0.");
  if (costFiniteCount > 0 && costZeroCount === costFiniteCount) globalWarnings.push("100% de los costos vienen en 0.");

  const appearsCatalog = (!hasQuantityColumn || !hasCostColumn) || (quantityFiniteCount > 0 && quantityZeroCount === quantityFiniteCount && costFiniteCount > 0 && costZeroCount === costFiniteCount);
  if (appearsCatalog) {
    globalWarnings.push("El archivo parece catálogo, no inventario.");
    globalWarnings.push("El archivo no es apto para importación de stock.");
  }

  return {
    rows,
    globalWarnings,
    blocksExecution: appearsCatalog,
    hasSkuColumn,
    hasNameColumn,
  };
}

function requiresInventory(importType: CatalogInventoryImportType | undefined) {
  return importType === undefined || importType === "CATALOG_WITH_INITIAL_INVENTORY" || importType === "INVENTORY_ONLY" || importType === "PHYSICAL_COUNT";
}

function requiresBranch(importType: CatalogInventoryImportType | undefined) {
  return requiresInventory(importType) || importType === "PRICES_COSTS_ONLY";
}

function detectImportAction(importType: CatalogInventoryImportType | undefined, productExists: boolean, quantity: number, unitCost: number, price?: number) {
  if (importType === "CATALOG_ONLY") return productExists ? "UPDATE_PRODUCT" : "CREATE_PRODUCT";
  if (importType === "PRICES_COSTS_ONLY") {
    if (price !== undefined) return "UPDATE_PRICE";
    if (Number.isFinite(unitCost)) return "UPDATE_COST";
    return "IGNORE";
  }
  if (importType === "PHYSICAL_COUNT") return "ADJUST_STOCK";
  if (importType === "INVENTORY_ONLY") return "ADJUST_STOCK";
  if (importType === "CATALOG_WITH_INITIAL_INVENTORY") return productExists ? "CREATE_INITIAL_INVENTORY" : "CREATE_AND_IMPORT";
  return productExists ? "IMPORT_EXISTING" : "CREATE_AND_IMPORT";
}

export async function parseInventoryImportPayload(input: Pick<PreviewInput, "fileContent" | "fileBase64" | "fileName">): Promise<ParseResult> {
  // XLSX vía exceljs (TypeScript puro, sin dependencia Python)
  if (input.fileBase64) {
    try {
      const matrix = await readExcelBase64(input.fileBase64);
      return parseRowsFromMatrix(matrix);
    } catch {
      return { rows: [], globalWarnings: ["No se pudo leer el archivo XLSX. Exporta a CSV o valida el formato Excel."], blocksExecution: true, hasSkuColumn: false, hasNameColumn: false };
    }
  }

  const content = input.fileContent ?? "";
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return { rows: [], globalWarnings: ["El archivo no contiene filas de datos."], blocksExecution: true, hasSkuColumn: false, hasNameColumn: false };
  }
  const delimiter = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const matrix = lines.map((line) => parseCsvLine(line, delimiter));
  return parseRowsFromMatrix(matrix);
}

export async function previewInventoryImport(input: PreviewInput) {
  const parsed = await parseInventoryImportPayload(input);
  const parsedRows = parsed.rows;
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  const branchById = new Map(branches.map((branch) => [branch.id, branch]));
  const branchByCode = new Map(branches.map((branch) => [branch.code.toUpperCase(), branch]));

  const reservedSkus = new Set<string>();
  const skuByRowNumber = new Map<number, string>();
  for (const row of parsedRows) {
    const sku = row.name.trim() || row.sku
      ? await generateSkuForProduct(prisma, {
          productName: row.name,
          categoryName: null,
          sku: row.sku,
        }, reservedSkus)
      : "";
    if (sku) reservedSkus.add(sku);
    skuByRowNumber.set(row.rowNumber, sku);
  }

  const allSkus = Array.from(new Set(skuByRowNumber.values()));
  const existingProducts = await prisma.product.findMany({
    where: { sku: { in: allSkus } },
    select: { id: true, sku: true },
  });
  const existingSkuSet = new Set(existingProducts.map((item) => item.sku.toUpperCase()));

  const resolveTargetBranches = (row: RawImportRow) => {
    if (input.destinationMode === "ALL") return branches;
    if (input.destinationMode === "SINGLE") {
      const branch = input.defaultBranchId ? branchById.get(input.defaultBranchId) : undefined;
      return branch ? [branch] : [];
    }
    if (input.destinationMode === "MULTI") {
      return (input.branchIds ?? [])
        .map((id) => branchById.get(id))
        .filter((branch): branch is NonNullable<typeof branch> => Boolean(branch));
    }
    if (!row.branchCode) return [];
    const branch = branchByCode.get(row.branchCode.trim().toUpperCase());
    return branch ? [branch] : [];
  };

  const duplicateKeySet = new Set<string>();
  const seenKeys = new Set<string>();
  const items: InventoryImportPreviewItem[] = [];

  for (const row of parsedRows) {
    const sku = skuByRowNumber.get(row.rowNumber) ?? normalizeManualSku(row.sku);
    const name = row.name?.trim() ?? "";
    const targetBranches = resolveTargetBranches(row);
    if (targetBranches.length === 0) {
      items.push({
        rowNumber: row.rowNumber,
        sku,
        name,
        quantity: Number.isFinite(row.quantity) ? row.quantity : 0,
        unitCost: Number.isFinite(row.unitCost) ? row.unitCost : 0,
        standardSalePrice: row.standardSalePrice,
        targetBranchId: "",
        targetBranchCode: "—",
        targetBranchName: "Sin sucursal válida",
        productStatus: sku && existingSkuSet.has(sku) ? "EXISTING" : "NEW",
        action: sku && existingSkuSet.has(sku) ? "IMPORT_EXISTING" : "CREATE_AND_IMPORT",
        status: "ERROR",
        messages: ["No se pudo resolver una sucursal de destino para esta fila."],
      });
      continue;
    }

    for (const branch of targetBranches) {
      const messages: string[] = [];
      if (!sku && !name) messages.push("SKU o nombre de producto requerido.");
      if (!Number.isFinite(row.quantity) || row.quantity <= 0) messages.push("Cantidad inválida (debe ser mayor a 0).");
      if (!Number.isFinite(row.unitCost) || row.unitCost < 0) messages.push("Costo unitario inválido.");

      const productExists = sku ? existingSkuSet.has(sku) : false;
      if (!productExists && !name) messages.push("Producto nuevo requiere nombre.");

      if (sku) {
        const key = `${branch.id}::${sku}`;
        if (seenKeys.has(key)) {
          duplicateKeySet.add(key);
          messages.push("Duplicado detectado en archivo para la misma sucursal + SKU.");
        }
        seenKeys.add(key);
      }

      items.push({
        rowNumber: row.rowNumber,
        sku,
        name,
        quantity: Number.isFinite(row.quantity) ? row.quantity : 0,
        unitCost: Number.isFinite(row.unitCost) ? row.unitCost : 0,
        standardSalePrice: row.standardSalePrice,
        targetBranchId: branch.id,
        targetBranchCode: branch.code,
        targetBranchName: branch.name,
        productStatus: productExists ? "EXISTING" : "NEW",
        action: productExists ? "IMPORT_EXISTING" : "CREATE_AND_IMPORT",
        status: messages.length > 0 ? "ERROR" : "READY",
        messages,
      });
    }
  }

  const normalizedItems = items.map((item) => {
    const key = `${item.targetBranchId}::${item.sku}`;
    if (!item.targetBranchId || !item.sku || !duplicateKeySet.has(key)) return item;
    const msgs = item.messages.includes("Duplicado detectado en archivo para la misma sucursal + SKU.")
      ? item.messages
      : [...item.messages, "Duplicado detectado en archivo para la misma sucursal + SKU."];
    return { ...item, status: "ERROR" as const, messages: msgs };
  });

  const summary = {
    parsedRows: parsedRows.length,
    expandedRows: normalizedItems.length,
    existingProducts: normalizedItems.filter((item) => item.productStatus === "EXISTING").length,
    newProducts: normalizedItems.filter((item) => item.productStatus === "NEW").length,
    ready: normalizedItems.filter((item) => item.status === "READY").length,
    errors: normalizedItems.filter((item) => item.status === "ERROR").length,
    globalWarnings: parsed.globalWarnings,
    blocksExecution: parsed.blocksExecution,
  };

  return { items: normalizedItems, summary };
}

export async function executeInventoryImport(input: ExecuteInput) {
  const result = {
    insertados: 0,
    actualizados: 0,
    omitidos: 0,
    errores: 0,
    details: [] as Array<{ rowNumber: number; sku: string; branchCode: string; status: "OK" | "SKIPPED" | "ERROR"; message: string }>,
  };

  const defaultUnit = input.defaultUnit?.trim() || "UN";
  const batchRef = `IMPORT-${Date.now()}`;
  const productCache = new Map<string, { id: string; sku: string }>();

  if (input.createMissingProducts && !input.defaultCategoryId) {
    throw new Error("INVALID_INPUT: Debes seleccionar categoría por defecto para crear productos nuevos.");
  }

  for (const item of input.items) {
    const cleanSku = normalizeManualSku(item.sku);
    const cleanName = item.name.trim();
    if (item.status !== "READY") {
      result.omitidos += 1;
      result.details.push({
        rowNumber: item.rowNumber,
        sku: item.sku,
        branchCode: item.targetBranchCode,
        status: "SKIPPED",
        message: "Fila en estado ERROR durante preview.",
      });
      continue;
    }

    try {
      let product = cleanSku ? productCache.get(cleanSku) : undefined;
      if (!product && cleanSku) {
        const found = await prisma.product.findUnique({
          where: { sku: cleanSku },
          select: { id: true, sku: true },
        });
        product = found ?? undefined;
      }
      if (!product && !cleanSku && cleanName) {
        const foundByName = await prisma.product.findFirst({
          where: { name: cleanName },
          select: { id: true, sku: true },
        });
        product = foundByName ?? undefined;
      }

      if (!product) {
        if (!input.createMissingProducts) {
          result.omitidos += 1;
          result.details.push({
            rowNumber: item.rowNumber,
            sku: item.sku,
            branchCode: item.targetBranchCode,
            status: "SKIPPED",
            message: "Producto no existe y creación automática está desactivada.",
          });
          continue;
        }

        const created = await createProduct({
          actorUserId: input.actorUserId,
          sku: cleanSku,
          name: cleanName,
          categoryId: input.defaultCategoryId!,
          unit: defaultUnit,
          allowsFraction: false,
          isTimber: false,
          standardSalePrice: item.standardSalePrice ?? input.defaultStandardSalePrice ?? 1,
          barcode: null,
          description: "Creado por importación masiva de inventario",
        });
        product = { id: created.id, sku: created.sku };
      }

      productCache.set(product.sku.toUpperCase(), product);

      await createInventoryMovement({
        actorUserId: input.actorUserId,
        branchId: item.targetBranchId,
        productId: product.id,
        movementType: "ADJUSTMENT_IN",
        quantity: item.quantity,
        unitCost: item.unitCost,
        referenceType: "IMPORT_EXCEL",
        referenceId: `${batchRef}-${item.rowNumber}`,
        notes: `Importación masiva (${item.targetBranchCode})`,
      });

      result.insertados += 1;
      result.actualizados += 1;
      result.details.push({
        rowNumber: item.rowNumber,
        sku: cleanSku || product.sku,
        branchCode: item.targetBranchCode,
        status: "OK",
        message: "Importado correctamente.",
      });
    } catch (error) {
      result.errores += 1;
      result.details.push({
        rowNumber: item.rowNumber,
        sku: cleanSku || "SIN-SKU",
        branchCode: item.targetBranchCode,
        status: "ERROR",
        message: error instanceof Error ? error.message : "Error desconocido al importar fila.",
      });
    }
  }

  return result;
}

export async function cleanupProductWithPolicy(input: {
  actorUserId: string;
  productId: string;
  mode: "AUTO" | "DEACTIVATE" | "DELETE_HARD";
}) {
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: input.productId },
    select: { id: true, name: true, isActive: true },
  });

  const [movementCount, saleLineCount, transferLineCount, purchaseLineCount] = await Promise.all([
    prisma.inventoryMovement.count({ where: { productId: product.id } }),
    prisma.saleOrderLine.count({ where: { productId: product.id } }),
    prisma.transferLine.count({ where: { productId: product.id } }),
    prisma.purchaseOrderLine.count({ where: { productId: product.id } }),
  ]);

  const hasHistory = movementCount + saleLineCount + transferLineCount + purchaseLineCount > 0;

  const shouldDeleteHard = input.mode === "DELETE_HARD" || (input.mode === "AUTO" && !hasHistory);
  if (shouldDeleteHard && hasHistory) {
    throw new Error("INVALID_INPUT: Producto con historial no permite delete duro; usa desactivación.");
  }

  if (shouldDeleteHard) {
    await prisma.product.delete({ where: { id: product.id } });
    return { action: "DELETED", hasHistory: false };
  }

  await prisma.product.update({
    where: { id: product.id },
    data: { isActive: false },
  });

  return { action: "DEACTIVATED", hasHistory };
}
