type PdfRow = Record<string, unknown>;

function cleanText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/[\\()]/g, "\\$&");
}

function truncate(value: unknown, max = 80) {
  const text = cleanText(value);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

export function buildReportPdf(input: { title: string; rows: PdfRow[]; generatedAt?: Date }) {
  const generatedAt = input.generatedAt ?? new Date();
  const columns = input.rows[0] ? Object.keys(input.rows[0]).slice(0, 6) : [];
  const lines = [
    input.title,
    `Generado: ${generatedAt.toISOString()}`,
    `Filas: ${input.rows.length}`,
    "",
    columns.length ? columns.join(" | ") : "Sin datos",
    columns.length ? columns.map(() => "----------").join(" | ") : "",
    ...input.rows.slice(0, 120).map((row) => columns.map((column) => truncate(row[column], 24)).join(" | ")),
  ];
  if (input.rows.length > 120) lines.push("", `Mostrando 120 de ${input.rows.length} filas.`);

  const pageHeight = 792;
  const pageWidth = 612;
  const marginX = 42;
  const startY = 742;
  const lineHeight = 13;
  const linesPerPage = Math.floor((startY - 50) / lineHeight);
  const pages: string[] = [];
  for (let index = 0; index < lines.length; index += linesPerPage) {
    const pageLines = lines.slice(index, index + linesPerPage);
    const body = pageLines
      .map((line, offset) => `BT /F1 9 Tf ${marginX} ${startY - offset * lineHeight} Td (${cleanText(line)}) Tj ET`)
      .join("\n");
    pages.push(body);
  }

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);
  objects.push(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  pages.forEach((content, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
  });

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
