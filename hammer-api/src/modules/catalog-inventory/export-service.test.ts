import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { buildCatalogExportWorkbookFromRows } from "@/modules/catalog-inventory/export-service";
import { normalizeHeader } from "@/modules/import-excel/header-matcher";

test("el catálogo exportado se lee de vuelta con los encabezados que el importador entiende", async () => {
  const buffer = await buildCatalogExportWorkbookFromRows(
    [{
      sku: "CEM-CEM-425KG-0001",
      barcode: null,
      name: "Cemento Canal 42.5kg",
      categoryName: "CEMENTO",
      unit: "UN",
      standardSalePrice: 220,
      globalCost: 185.5,
      isActive: true,
      stockByBranchId: { b1: 12.5 },
    }],
    [{ id: "b1", code: "MGA" }, { id: "b2", code: "MSY" }],
  );

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.getWorksheet("Catalogo")!;
  const header = (sheet.getRow(1).values as unknown[]).slice(1).map(String);

  assert.deepEqual(header, ["sku", "codigo_barras", "nombre", "categoria", "unidad", "precio", "costo", "activo", "stock MGA", "stock MSY"]);
  // Las columnas de stock no deben caer en el alias "stock" (= cantidad) del importador.
  assert.ok(!header.map(normalizeHeader).includes("stock"));
  assert.deepEqual((sheet.getRow(2).values as unknown[]).slice(1), ["CEM-CEM-425KG-0001", "", "Cemento Canal 42.5kg", "CEMENTO", "UN", 220, 185.5, "SI", 12.5, 0]);
  assert.equal(sheet.rowCount, 2);
});
