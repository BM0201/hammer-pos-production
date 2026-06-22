import type { ReportColumnDefinition, ReportDefinition, ReportRow, ReportSummaryCard } from "@/modules/reports/report-definitions";
import {
  formatCurrency,
  formatDateLocal,
  formatNumber,
  formatPercent,
  formatStatus,
  getNestedValue,
  safeText,
  toNumber,
  truncateMiddle,
} from "@/modules/reports/report-formatters";

type PdfFilter = {
  label: string;
  value: string;
};

type BuildReportPdfInput = {
  title?: string;
  rows: ReportRow[];
  reportDefinition: ReportDefinition;
  filters?: PdfFilter[];
  generatedBy?: string;
  generatedAt?: Date;
  totalRowCount?: number;
  warnings?: string[];
  summary?: ReportSummaryCard[];
  options?: {
    filename?: string;
  };
};

type PageSize = {
  width: number;
  height: number;
};

const PAGE_SIZES: Record<ReportDefinition["orientation"], PageSize> = {
  portrait: { width: 612, height: 792 },
  landscape: { width: 792, height: 612 },
};

const MARGIN = 34;
const FOOTER_HEIGHT = 36;
const HEADER_HEIGHT = 74;
const TABLE_ROW_HEIGHT = 18;
const TABLE_HEADER_HEIGHT = 20;
const GRID_GRAY = 0.83;
const TEXT_GRAY = 0.18;

function cleanPdfText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/[\\()]/g, "\\$&");
}

function normalizeColumns(definition: ReportDefinition, rows: ReportRow[]) {
  const configured: ReportColumnDefinition[] = definition.columns.length > 0
    ? definition.columns
    : Object.keys(rows[0] ?? {}).map((key) => ({ key, label: key, width: 12, type: "text" as const }));

  return configured.filter((column) => {
    if (!column.hideWhenEmpty) return true;
    return rows.some((row) => safeText(getNestedValue(row, column.key), "") !== "");
  });
}

function formatCell(row: ReportRow, column: ReportColumnDefinition) {
  const raw = getNestedValue(row, column.key);
  if (column.formatter) return column.formatter(raw, row);
  switch (column.type) {
    case "currency":
      return formatCurrency(raw);
    case "date":
      return raw ? formatDateLocal(raw) : "";
    case "number":
      return formatNumber(raw);
    case "percent":
      return formatPercent(raw);
    case "status":
      return formatStatus(raw);
    default:
      return safeText(raw, "");
  }
}

function columnWidths(columns: ReportColumnDefinition[], tableWidth: number) {
  const totalWeight = columns.reduce((sum, column) => sum + column.width, 0) || columns.length || 1;
  return columns.map((column) => (column.width / totalWeight) * tableWidth);
}

function wrapText(value: string, maxChars: number, maxLines = 2) {
  const words = value.split(" ");
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  });
  if (current) lines.push(current);
  return lines.slice(0, maxLines).map((line, index) => {
    if (index === maxLines - 1 && lines.length > maxLines) return truncateMiddle(line, Math.max(6, maxChars - 3));
    return line;
  });
}

class PdfPage {
  readonly commands: string[] = [];

  constructor(readonly size: PageSize) {}

  text(text: string, x: number, y: number, size = 9, font: "F1" | "F2" = "F1", gray = TEXT_GRAY) {
    this.commands.push(`${gray} g BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${cleanPdfText(text)}) Tj ET`);
  }

  rightText(text: string, x: number, y: number, size = 9, font: "F1" | "F2" = "F1", gray = TEXT_GRAY) {
    const estimatedWidth = text.length * size * 0.48;
    this.text(text, x - estimatedWidth, y, size, font, gray);
  }

  rect(x: number, y: number, width: number, height: number, gray = 0.95) {
    this.commands.push(`q ${gray} g ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f Q`);
  }

  strokeRect(x: number, y: number, width: number, height: number, gray = GRID_GRAY) {
    this.commands.push(`q ${gray} G 0.5 w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S Q`);
  }

  line(x1: number, y1: number, x2: number, y2: number, gray = GRID_GRAY) {
    this.commands.push(`q ${gray} G 0.5 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`);
  }
}

function renderHeader(page: PdfPage, input: BuildReportPdfInput, compact = false) {
  const { width, height } = page.size;
  const definition = input.reportDefinition;
  page.rect(0, height - HEADER_HEIGHT, width, HEADER_HEIGHT, definition.type === "audit" ? 0.91 : definition.type === "inventory" ? 0.9 : 0.88);
  page.text("Hammer POS", MARGIN, height - 28, 13, "F2");
  page.text(input.title ?? definition.title, MARGIN, height - 46, 16, "F2");
  page.text(definition.subtitle, MARGIN, height - 61, 9, "F1", 0.28);
  page.rightText(definition.detailLabel, width - MARGIN, height - 29, 9, "F2", 0.25);
  if (!compact) {
    page.rightText(`Generado: ${formatDateLocal(input.generatedAt ?? new Date())}`, width - MARGIN, height - 46, 8, "F1", 0.3);
    page.rightText(`Usuario: ${safeText(input.generatedBy, "N/D")}`, width - MARGIN, height - 60, 8, "F1", 0.3);
  }
}

function renderFooter(page: PdfPage, pageNumber: number, totalPages: number, generatedAt: Date) {
  const { width } = page.size;
  page.line(MARGIN, FOOTER_HEIGHT + 10, width - MARGIN, FOOTER_HEIGHT + 10, 0.78);
  page.text("Generado por Hammer POS", MARGIN, 24, 8, "F1", 0.35);
  page.text("Documento administrativo interno. No sustituye factura fiscal.", MARGIN, 12, 7, "F1", 0.42);
  page.rightText(`Pagina ${pageNumber} de ${totalPages}`, width - MARGIN, 24, 8, "F1", 0.35);
  page.rightText(formatDateLocal(generatedAt), width - MARGIN, 12, 7, "F1", 0.42);
}

function renderSummary(page: PdfPage, cards: ReportSummaryCard[], startY: number, width: number) {
  if (cards.length === 0) return startY;
  page.text("Resumen ejecutivo", MARGIN, startY, 11, "F2");
  const gap = 8;
  const cardCount = Math.min(4, cards.length);
  const cardWidth = (width - gap * (cardCount - 1)) / cardCount;
  const y = startY - 48;
  cards.slice(0, cardCount).forEach((card, index) => {
    const x = MARGIN + index * (cardWidth + gap);
    page.rect(x, y, cardWidth, 38, 0.95);
    page.strokeRect(x, y, cardWidth, 38, 0.84);
    page.text(card.label, x + 8, y + 24, 7, "F2", 0.36);
    page.text(card.value, x + 8, y + 10, 11, "F2", 0.15);
  });
  return y - 18;
}

function renderFilters(page: PdfPage, filters: PdfFilter[], startY: number, width: number) {
  page.text("Filtros aplicados", MARGIN, startY, 10, "F2");
  const body = filters.length ? filters : [{ label: "Filtros", value: "Sin filtros adicionales" }];
  const columns = 3;
  const colWidth = width / columns;
  let y = startY - 15;
  body.forEach((filter, index) => {
    const x = MARGIN + (index % columns) * colWidth;
    if (index > 0 && index % columns === 0) y -= 14;
    page.text(`${filter.label}: ${filter.value}`, x, y, 8, "F1", 0.28);
  });
  return y - 18;
}

function renderWarnings(page: PdfPage, warnings: string[], startY: number, width: number) {
  if (!warnings.length) return startY;
  const boxHeight = Math.max(28, 15 + warnings.length * 12);
  page.rect(MARGIN, startY - boxHeight + 8, width, boxHeight, 0.96);
  page.strokeRect(MARGIN, startY - boxHeight + 8, width, boxHeight, 0.74);
  page.text("Advertencias", MARGIN + 8, startY - 8, 9, "F2", 0.2);
  warnings.slice(0, 4).forEach((warning, index) => {
    page.text(`- ${warning}`, MARGIN + 8, startY - 21 - index * 11, 8, "F1", 0.28);
  });
  return startY - boxHeight - 8;
}

function renderLegend(page: PdfPage, startY: number) {
  page.text("Leyenda de estados: POSTED=Cobrado, PENDING=Pendiente, DISPATCHED=Despachado, CANCELLED=Cancelado, REFUNDED=Reembolsado, IN_PROGRESS=En proceso.", MARGIN, startY, 7, "F1", 0.42);
  return startY - 14;
}

function renderTableHeader(page: PdfPage, columns: ReportColumnDefinition[], widths: number[], x: number, y: number, tableWidth: number) {
  page.rect(x, y - TABLE_HEADER_HEIGHT + 4, tableWidth, TABLE_HEADER_HEIGHT, 0.9);
  page.strokeRect(x, y - TABLE_HEADER_HEIGHT + 4, tableWidth, TABLE_HEADER_HEIGHT, 0.72);
  let cursorX = x;
  columns.forEach((column, index) => {
    page.text(column.label, cursorX + 4, y - 10, 7, "F2", 0.18);
    if (index > 0) page.line(cursorX, y + 4, cursorX, y - TABLE_HEADER_HEIGHT + 4, 0.78);
    cursorX += widths[index] ?? 0;
  });
}

function renderTableRow(page: PdfPage, row: ReportRow, columns: ReportColumnDefinition[], widths: number[], x: number, y: number, rowIndex: number) {
  if (rowIndex % 2 === 1) {
    page.rect(x, y - TABLE_ROW_HEIGHT + 4, widths.reduce((sum, width) => sum + width, 0), TABLE_ROW_HEIGHT, 0.975);
  }
  let cursorX = x;
  columns.forEach((column, index) => {
    const width = widths[index] ?? 0;
    const maxChars = Math.max(6, Math.floor(width / 4.2));
    const value = formatCell(row, column);
    const display = column.type === "text" ? truncateMiddle(value, column.maxLength ?? maxChars) : truncateMiddle(value, maxChars);
    const textX = column.align === "right" ? cursorX + width - 4 : cursorX + 4;
    if (column.align === "right") {
      page.rightText(display, textX, y - 8, 7, "F1", 0.2);
    } else {
      wrapText(display, maxChars, 1).forEach((line, offset) => page.text(line, textX, y - 8 - offset * 8, 7, "F1", 0.2));
    }
    if (index > 0) page.line(cursorX, y + 4, cursorX, y - TABLE_ROW_HEIGHT + 4, 0.88);
    cursorX += width;
  });
  page.line(x, y - TABLE_ROW_HEIGHT + 4, x + widths.reduce((sum, width) => sum + width, 0), y - TABLE_ROW_HEIGHT + 4, 0.9);
}

function renderTotals(page: PdfPage, input: BuildReportPdfInput, columns: ReportColumnDefinition[], widths: number[], x: number, y: number) {
  const totals = input.reportDefinition.totals ?? [];
  if (!totals.length) return y;
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  page.rect(x, y - TABLE_ROW_HEIGHT + 4, tableWidth, TABLE_ROW_HEIGHT, 0.91);
  page.text("Totales", x + 4, y - 8, 8, "F2", 0.16);

  totals.forEach((total) => {
    const columnIndex = columns.findIndex((column) => column.key === total.key);
    if (columnIndex < 0) return;
    const value = input.rows.reduce((amount, row) => amount + toNumber(row[total.key]), 0);
    const display = total.type === "number" ? formatNumber(value) : formatCurrency(value);
    const cellX = x + widths.slice(0, columnIndex + 1).reduce((sum, width) => sum + width, 0) - 4;
    page.rightText(display, cellX, y - 8, 8, "F2", 0.16);
  });
  return y - TABLE_ROW_HEIGHT;
}

function collectWarnings(input: BuildReportPdfInput) {
  const warnings = new Set<string>(input.warnings ?? []);
  input.reportDefinition.warnings?.(input.rows).forEach((warning) => warnings.add(warning));
  const policy = input.reportDefinition.rowLimitPolicy;
  const totalRowCount = input.totalRowCount ?? input.rows.length;
  if (policy?.warningThreshold && totalRowCount >= policy.warningThreshold) {
    warnings.add(`Mostrando ${input.rows.length} filas por limite operativo. Use CSV y filtros mas especificos para auditoria completa.`);
  }
  return [...warnings];
}

function buildPageObjects(pages: PdfPage[]) {
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);
  objects.push(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  pages.forEach((page, index) => {
    const pageId = 5 + index * 2;
    const contentId = pageId + 1;
    const content = page.commands.join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.size.width} ${page.size.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
  });
  return objects;
}

export function buildReportPdf(input: BuildReportPdfInput) {
  const generatedAt = input.generatedAt ?? new Date();
  const definition = input.reportDefinition;
  const size = PAGE_SIZES[definition.orientation];
  const tableWidth = size.width - MARGIN * 2;
  const columns = normalizeColumns(definition, input.rows);
  const widths = columnWidths(columns, tableWidth);
  const warnings = collectWarnings(input);
  const summary = input.summary ?? definition.summaryCards?.(input.rows) ?? [];
  const filters = [
    ...(input.filters ?? []),
    { label: "Formato", value: definition.detailLabel },
    { label: "Filas", value: String(input.totalRowCount ?? input.rows.length) },
  ];

  const pages: PdfPage[] = [];
  let page = new PdfPage(size);
  pages.push(page);
  renderHeader(page, input);
  let y = size.height - HEADER_HEIGHT - 22;
  y = renderSummary(page, summary, y, tableWidth);
  y = renderFilters(page, filters, y, tableWidth);
  y = renderWarnings(page, warnings, y, tableWidth);
  y = renderLegend(page, y);

  function ensurePage(requiredHeight: number) {
    if (y - requiredHeight > FOOTER_HEIGHT + 24) return;
    page = new PdfPage(size);
    pages.push(page);
    renderHeader(page, input, true);
    y = size.height - HEADER_HEIGHT - 14;
  }

  if (!columns.length) {
    page.text("Sin datos para los filtros seleccionados.", MARGIN, y - 10, 10, "F2", 0.25);
  } else {
    ensurePage(TABLE_HEADER_HEIGHT + TABLE_ROW_HEIGHT);
    renderTableHeader(page, columns, widths, MARGIN, y, tableWidth);
    y -= TABLE_HEADER_HEIGHT;
    input.rows.forEach((row, index) => {
      ensurePage(TABLE_HEADER_HEIGHT + TABLE_ROW_HEIGHT);
      if (y > size.height - HEADER_HEIGHT - 16) {
        renderTableHeader(page, columns, widths, MARGIN, y, tableWidth);
        y -= TABLE_HEADER_HEIGHT;
      }
      renderTableRow(page, row, columns, widths, MARGIN, y, index);
      y -= TABLE_ROW_HEIGHT;
    });
    ensurePage(TABLE_HEADER_HEIGHT + TABLE_ROW_HEIGHT);
    y = renderTotals(page, input, columns, widths, MARGIN, y);
  }

  pages.forEach((item, index) => renderFooter(item, index + 1, pages.length, generatedAt));

  const objects = buildPageObjects(pages);
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}
