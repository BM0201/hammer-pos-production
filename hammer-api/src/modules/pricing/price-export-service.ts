import ExcelJS from "exceljs";
import { getCurrentPrices, type CurrentPriceSource, type CurrentPricesSort } from "@/modules/pricing/current-prices-service";

/**
 * prompt-carga-precios.md Fase 4 — "Descargar lista para actualizar" desde
 * Precios vigentes. Mismo motor que la pantalla (getCurrentPrices) — nunca
 * una segunda consulta de precios/costos. .xlsx vía exceljs porque ya es
 * la librería que lee los archivos de esta app (import-excel/excel-reader.ts);
 * no hace falta agregar ninguna dependencia nueva para escribirlos.
 *
 * limit alto y explícito (no el default de 50 de getCurrentPrices, ni el
 * tope de 200 de la ruta de listado): esto es una descarga completa del
 * filtro, no una página — un límite bajo truncaría la planilla sin que se
 * note. 5000 es un techo generoso para el catálogo de una sola sucursal.
 */
const EXPORT_ROW_LIMIT = 5000;

export async function buildPriceExportWorkbook(filters: {
  branchId: string;
  categoryId?: string;
  q?: string;
  priceSource?: CurrentPriceSource;
  sort?: CurrentPricesSort;
}): Promise<{ buffer: ExcelJS.Buffer; rowCount: number }> {
  const result = await getCurrentPrices({ ...filters, limit: EXPORT_ROW_LIMIT, page: 1 });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Precios");
  sheet.addRow(["SKU", "Nombre", "Categoria", "PrecioVigente", "PrecioNuevo"]);
  for (const row of result.rows) {
    sheet.addRow([row.sku, row.name, row.categoryName, row.effectivePrice ?? "", ""]);
  }
  sheet.getColumn(1).width = 16;
  sheet.getColumn(2).width = 40;
  sheet.getColumn(3).width = 20;
  sheet.getColumn(4).width = 16;
  sheet.getColumn(5).width = 16;

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer, rowCount: result.rows.length };
}
