/**
 * prompt-alta-productos-qr.md Fase 3 — etiquetas QR imprimibles, puras (sin
 * red, sin DOM): dado un arreglo de productos ya cargado, devuelve el HTML
 * listo para `printHtml`. El QR se genera con `qrcode` (create(), API
 * síncrona y pura — sin esto sería async y dejaría de ser una función pura
 * testeable sin awaits).
 */
import { create as createQrCode } from "qrcode";

export type LabelPaperWidth = "W58MM" | "W80MM";

export type LabelProductInput = {
  name: string;
  sku: string;
  barcode: string | null;
  standardSalePrice: number;
};

export type BuildLabelsHtmlOptions = {
  paperWidth: LabelPaperWidth;
  copies: number;
  showPrice: boolean;
};

// Ancho de etiqueta = ancho de papel térmico (un producto por etiqueta).
const PAPER_LABEL_WIDTH_MM: Record<LabelPaperWidth, number> = {
  W58MM: 58,
  W80MM: 80,
};

// El doc exige que el QR mida AL MENOS 20mm para leerse con la cámara de
// una tablet desde 15-20cm — 22mm da margen sin desperdiciar papel de más.
const QR_SIZE_MM = 22;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Nombre a 2 líneas máximo, cortado con «…». Estimación simple por
 * cantidad de caracteres (no vale la pena medir el ancho real de fuente
 * para una etiqueta térmica de 58/80mm) — más angosto en 58mm.
 */
function truncateNameForLabel(name: string, maxCharsPerLine: number): string {
  const limit = maxCharsPerLine * 2;
  if (name.length <= limit) return name;
  return `${name.slice(0, Math.max(0, limit - 1))}…`;
}

function buildQrSvg(text: string, sizeMm: number): string {
  const qr = createQrCode(text, { errorCorrectionLevel: "M" });
  const modules = qr.modules;
  const size = modules.size;
  let cells = "";
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (modules.get(row, col)) {
        cells += `<rect x="${col}" y="${row}" width="1" height="1"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${sizeMm}mm" height="${sizeMm}mm" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#000">${cells}</g></svg>`;
}

function buildSingleLabelHtml(product: LabelProductInput, opts: { widthMm: number; showPrice: boolean }): string {
  const qrSvg = buildQrSvg(product.barcode!, QR_SIZE_MM);
  const safeName = escapeHtml(truncateNameForLabel(product.name, opts.widthMm <= 58 ? 16 : 22));
  const safeSku = escapeHtml(product.sku);
  const priceHtml = opts.showPrice
    ? `<div class="label-price">C$${product.standardSalePrice.toFixed(2)}</div>`
    : "";
  return `<div class="label">
    <div class="label-qr">${qrSvg}</div>
    <div class="label-name">${safeName}</div>
    <div class="label-sku">${safeSku}</div>
    ${priceHtml}
  </div>`;
}

/**
 * HTML listo para `printHtml` — un producto sin barcode NUNCA genera
 * etiqueta (no hay nada que escanear): se omite en silencio, no es un error.
 */
export function buildLabelsHtml(products: LabelProductInput[], options: BuildLabelsHtmlOptions): string {
  const widthMm = PAPER_LABEL_WIDTH_MM[options.paperWidth] ?? PAPER_LABEL_WIDTH_MM.W80MM;
  const copies = Math.max(1, Math.floor(options.copies));

  const labels: string[] = [];
  for (const product of products) {
    if (!product.barcode) continue;
    for (let i = 0; i < copies; i += 1) {
      labels.push(buildSingleLabelHtml(product, { widthMm, showPrice: options.showPrice }));
    }
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Etiquetas de productos</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 2mm; }
  body { margin: 0; font-family: Arial, sans-serif; }
  .label {
    width: ${widthMm}mm;
    box-sizing: border-box;
    padding: 2mm;
    text-align: center;
    page-break-after: always;
  }
  .label-qr { display: flex; justify-content: center; margin-bottom: 1mm; }
  .label-name { font-size: 9pt; font-weight: bold; line-height: 1.1; word-break: break-word; }
  .label-sku { font-size: 7pt; color: #444; margin-top: 0.5mm; }
  .label-price { font-size: 10pt; font-weight: bold; margin-top: 0.5mm; }
</style>
</head>
<body>
${labels.join("\n")}
</body>
</html>`;
}
