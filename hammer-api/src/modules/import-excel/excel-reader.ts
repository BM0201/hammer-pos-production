/**
 * ═══════════════════════════════════════════════════════════════════════════
 * H.A.M.M.E.R. — Excel Reader (TypeScript puro, sin dependencia Python)
 *
 * Lee archivos XLSX y CSV y devuelve una matriz string[][].
 * Usa `exceljs` para parsear archivos Excel nativamente en Node.js.
 *
 * FORMATO EXCEL ESPERADO:
 * ──────────────────────────────────────────────────────────────────────────
 * Fila 1: Encabezados (se buscan columnas por alias):
 *   • SKU / Código / Code
 *   • Nombre / Name / Producto / Descripción
 *   • Cantidad / Qty / Quantity / Cant
 *   • CostoUnitario / UnitCost / Costo / Cost
 *   • Precio / Price / StandardSalePrice  (opcional)
 *   • Sucursal / Branch / BranchCode       (opcional, modo FILE)
 *
 * Filas 2+: Datos de productos a importar.
 * Se aceptan archivos .xlsx, .xls (vía exceljs) y .csv (parser propio).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import ExcelJS from "exceljs";

/**
 * Lee un buffer XLSX y retorna la primera hoja como string[][].
 * Fila 0 = encabezados, filas 1+ = datos.
 */
export async function readExcelBuffer(buffer: Buffer | Uint8Array): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount === 0) {
    return [];
  }

  const matrix: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    // row.values is 1-indexed (index 0 is undefined)
    const values = row.values as (string | number | boolean | Date | null | undefined)[];
    for (let i = 1; i < values.length; i++) {
      const v = values[i];
      if (v === null || v === undefined) {
        cells.push("");
      } else if (v instanceof Date) {
        cells.push(v.toISOString());
      } else {
        cells.push(String(v));
      }
    }
    matrix.push(cells);
  });

  return matrix;
}

/**
 * Lee un string Base64 de un archivo XLSX y retorna string[][].
 */
export async function readExcelBase64(base64: string): Promise<string[][]> {
  const buffer = Buffer.from(base64, "base64");
  return readExcelBuffer(buffer);
}

/**
 * Parsea contenido CSV/TSV y retorna string[][].
 */
export function readCsvContent(content: string): string[][] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [];

  const delimiter = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  return lines.map((line) => parseCsvLine(line, delimiter));
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
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
