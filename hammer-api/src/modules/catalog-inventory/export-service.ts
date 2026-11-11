import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";

/**
 * Exportación del catálogo completo (pestaña Calidad → Importar / Exportar).
 * Mismo patrón que pricing/price-export-service.ts: exceljs, sin límite de
 * página (el listado del catálogo topa en 1000 y truncaría la planilla).
 *
 * Los encabezados son alias que el importador ya lee (import-service.ts
 * readRows: sku, nombre, categoria, unidad, precio, costo) — el archivo se
 * puede editar y volver a subir como "Solo Catálogo" o "Solo Precios/Costos".
 * Las columnas extra (codigo_barras, activo, "stock <SUC>") no chocan con
 * ningún alias, así que el importador las ignora.
 */
export type CatalogExportRow = {
  sku: string;
  barcode: string | null;
  name: string;
  categoryName: string;
  unit: string;
  standardSalePrice: number;
  globalCost: number | null;
  isActive: boolean;
  stockByBranchId: Record<string, number>;
};

export type CatalogExportBranch = { id: string; code: string };

export async function buildCatalogExportWorkbookFromRows(
  rows: CatalogExportRow[],
  branches: CatalogExportBranch[],
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Catalogo", { views: [{ state: "frozen", ySplit: 1 }] });
  const font = { name: "Arial", size: 10 };

  sheet.columns = [
    { header: "sku", key: "sku", width: 22 },
    { header: "codigo_barras", key: "barcode", width: 18 },
    { header: "nombre", key: "name", width: 44 },
    { header: "categoria", key: "category", width: 22 },
    { header: "unidad", key: "unit", width: 9 },
    { header: "precio", key: "price", width: 12, style: { numFmt: "#,##0.00" } },
    { header: "costo", key: "cost", width: 12, style: { numFmt: "#,##0.00" } },
    { header: "activo", key: "active", width: 8 },
    ...branches.map((b) => ({ header: `stock ${b.code}`, key: `stock_${b.id}`, width: 12, style: { numFmt: "#,##0.####" } })),
  ];

  for (const row of rows) {
    const stock = Object.fromEntries(branches.map((b) => [`stock_${b.id}`, row.stockByBranchId[b.id] ?? 0]));
    sheet.addRow({
      sku: row.sku,
      barcode: row.barcode ?? "",
      name: row.name,
      category: row.categoryName,
      unit: row.unit,
      price: row.standardSalePrice,
      cost: row.globalCost ?? "",
      active: row.isActive ? "SI" : "NO",
      ...stock,
    });
  }

  sheet.eachRow((r) => { r.font = font; });
  sheet.getRow(1).font = { ...font, bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };

  return workbook.xlsx.writeBuffer();
}

export async function buildCatalogExportWorkbook(): Promise<{ buffer: ExcelJS.Buffer; rowCount: number }> {
  const [branches, products] = await Promise.all([
    prisma.branch.findMany({ where: { isActive: true }, select: { id: true, code: true }, orderBy: { code: "asc" } }),
    prisma.product.findMany({
      orderBy: { name: "asc" },
      select: {
        sku: true,
        barcode: true,
        name: true,
        unit: true,
        standardSalePrice: true,
        globalCost: true,
        isActive: true,
        category: { select: { name: true } },
        barcodes: { where: { isPrimary: true }, select: { code: true }, take: 1 },
        inventoryBalances: { select: { branchId: true, quantityOnHand: true } },
      },
    }),
  ]);

  const rows: CatalogExportRow[] = products.map((p) => ({
    sku: p.sku,
    barcode: p.barcode ?? p.barcodes[0]?.code ?? null,
    name: p.name,
    categoryName: p.category.name,
    unit: p.unit,
    standardSalePrice: Number(p.standardSalePrice),
    globalCost: p.globalCost === null ? null : Number(p.globalCost),
    isActive: p.isActive,
    stockByBranchId: Object.fromEntries(p.inventoryBalances.map((b) => [b.branchId, Number(b.quantityOnHand)])),
  }));

  return { buffer: await buildCatalogExportWorkbookFromRows(rows, branches), rowCount: rows.length };
}
