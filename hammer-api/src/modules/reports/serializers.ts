function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }
  return text;
}

export function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const header = columns.join(",");
  const lines = rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(","));
  return [header, ...lines].join("\n");
}
