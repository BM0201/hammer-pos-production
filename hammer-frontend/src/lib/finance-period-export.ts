import type { ExpensePeriodReport } from "@/components/finance/expenses-period.types";
import { SOURCE_LABELS, ledgerCategoryLabel } from "@/components/finance/expenses-period.types";
import { money, fmtDateTime } from "@/lib/format";

/**
 * prompt-gastos-semana-quincena.md Fase 3 — exportar (CSV) e imprimir
 * (HTML A4) el libro de gastos de un período. Puras a propósito: ni abren
 * ventanas ni tocan el DOM, así se testea el CONTENIDO sin un navegador
 * (print-product-labels.ts es el mismo patrón: builder puro + un wrapper
 * no-puro que llama printHtml/recordPrintAudit).
 */

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildExpensePeriodCsv(report: ExpensePeriodReport): string {
  const header = ["Fecha", "Sucursal", "Categoría", "Concepto", "Descripción", "Beneficiario", "Recibo", "Monto", "Fuente"];
  const lines = [header.map(csvEscape).join(",")];
  for (const row of report.rows.items) {
    lines.push([
      fmtDateTime(row.date),
      row.branchName ?? "",
      ledgerCategoryLabel(row.category),
      row.conceptName ?? "",
      row.description,
      row.payee ?? "",
      row.receiptNumber ?? "",
      row.amount.toFixed(2),
      SOURCE_LABELS[row.source] ?? row.source,
    ].map((v) => csvEscape(String(v))).join(","));
  }
  return lines.join("\n");
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Reporte imprimible A4: encabezado del período, KPIs y el detalle por categoría. El libro completo queda en el CSV — imprimir todas las filas no entra en una hoja. */
export function buildExpensePeriodPrintHtml(report: ExpensePeriodReport, opts: { branchLabel: string }): string {
  const { totals, byCategory, period, basis } = report;
  const rows = byCategory
    .filter((c) => c.total > 0 || c.budgetProrated > 0)
    .map((c) => `
      <tr>
        <td>${esc(ledgerCategoryLabel(c.category))}</td>
        <td style="text-align:right">${esc(money(c.total))}</td>
        <td style="text-align:right">${esc(money(c.budgetProrated))}</td>
        <td style="text-align:right">${c.budgetExecutedPercent != null ? `${c.budgetExecutedPercent.toFixed(0)}%` : "—"}</td>
      </tr>`)
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Gastos operativos — ${esc(period.label)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: Arial, sans-serif; color: #111; font-size: 12px; }
  h1 { font-size: 18px; margin-bottom: 2px; }
  h2 { font-size: 13px; color: #555; margin-top: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; }
  th { background: #f3f4f6; }
  .kpis { display: flex; gap: 16px; margin-top: 12px; }
  .kpi { border: 1px solid #ddd; border-radius: 6px; padding: 8px 12px; flex: 1; }
  .kpi .label { font-size: 10px; color: #666; }
  .kpi .value { font-size: 16px; font-weight: bold; }
</style>
</head>
<body>
  <h1>Gastos operativos</h1>
  <h2>${esc(period.label)} — ${esc(opts.branchLabel)} — base ${basis === "ACCRUED" ? "devengado" : "pagado"}</h2>
  <div class="kpis">
    <div class="kpi"><div class="label">Gasto total</div><div class="value">${esc(money(totals.expenseTotal))}</div></div>
    <div class="kpi"><div class="label">Gasto / ventas</div><div class="value">${totals.expenseToSalesPercent != null ? `${totals.expenseToSalesPercent.toFixed(1)}%` : "—"}</div></div>
    <div class="kpi"><div class="label">Utilidad operativa</div><div class="value">${esc(money(totals.operatingProfit))}</div></div>
  </div>
  <table>
    <thead><tr><th>Categoría</th><th style="text-align:right">Gasto</th><th style="text-align:right">Presupuesto</th><th style="text-align:right">% ejecutado</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}
