import { buildHeaderIndex, pickByAlias } from "@/modules/import-excel/header-matcher";

/**
 * prompt-carga-precios.md Fase 4 — parseo del archivo de carga de precios.
 * Puro (recibe la matriz ya leída, nunca abre un archivo ni toca la DB) —
 * price-update-import-service.ts es la única parte con I/O.
 */

export const MAX_PRICE_IMPORT_ROWS = 2000;

const SKU_ALIASES = ["sku", "codigo", "code", "itemcode", "productcode", "referencia", "ref", "clave", "articulo"];
const BARCODE_ALIASES = ["barcode", "codigobarras", "codigodebarras", "ean", "upc"];
const NEW_PRICE_ALIASES = ["precionuevo", "nuevoprecio", "newprice", "precio", "price", "preciodeventa", "preciofinal"];

/**
 * "1,250.50" (coma miles, punto decimal), "1.250,50" (punto miles, coma
 * decimal), "C$ 1,250" (símbolo + miles sin decimales), "1250,5" (coma
 * decimal, sin miles) — todas deben dar el mismo número que si alguien las
 * tecleara a mano. Sin separador ambiguo (coma Y punto a la vez), el que
 * aparece MÁS A LA DERECHA es el decimal; el otro, si lo hay, es de miles.
 * Con un solo tipo de separador, un grupo final de 1-2 dígitos es decimal
 * ("1250,5"), de 3+ es de miles ("1,250"). El signo se conserva — que un
 * precio nuevo sea negativo lo rechaza classifyLine (newPrice<=0), no esto:
 * acá solo se parsea el número, no se valida el negocio.
 */
export function parsePriceCell(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const stripped = trimmed.replace(/[A-Za-z$]/g, "").replace(/\s/g, "");
  if (stripped === "") return null;

  const hasComma = stripped.includes(",");
  const hasDot = stripped.includes(".");
  let normalized: string;

  if (hasComma && hasDot) {
    const decimalIsComma = stripped.lastIndexOf(",") > stripped.lastIndexOf(".");
    normalized = decimalIsComma ? stripped.replace(/\./g, "").replace(",", ".") : stripped.replace(/,/g, "");
  } else if (hasComma) {
    const parts = stripped.split(",");
    const looksLikeDecimal = parts.length === 2 && parts[1].length <= 2;
    normalized = looksLikeDecimal ? parts.join(".") : stripped.replace(/,/g, "");
  } else {
    normalized = stripped;
  }

  if (!/\d/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export type ParsedPriceImportRow = {
  rowNumber: number;
  sku: string;
  barcode: string;
  rawNewPrice: string;
  newPrice: number | null;
};

/** Fila 1 = encabezados, filas 2+ = datos. Se descarta una fila sin SKU ni código de barras — no hay con qué buscar el producto. */
export function parsePriceImportMatrix(matrix: string[][]): ParsedPriceImportRow[] {
  if (matrix.length < 2) return [];
  const index = buildHeaderIndex(matrix[0]);

  return matrix
    .slice(1)
    .map((cells, idx) => {
      const sku = pickByAlias(cells, index, SKU_ALIASES);
      const barcode = pickByAlias(cells, index, BARCODE_ALIASES);
      const rawNewPrice = pickByAlias(cells, index, NEW_PRICE_ALIASES);
      return { rowNumber: idx + 2, sku, barcode, rawNewPrice, newPrice: parsePriceCell(rawNewPrice) };
    })
    .filter((row) => row.sku || row.barcode);
}
