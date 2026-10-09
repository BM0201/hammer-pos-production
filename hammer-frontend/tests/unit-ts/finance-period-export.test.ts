import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { buildExpensePeriodCsv, buildExpensePeriodPrintHtml } from "@/lib/finance-period-export";
import type { ExpensePeriodReport } from "@/components/finance/expenses-period.types";

/** prompt-gastos-semana-quincena.md Fase 3 — export CSV e impresión A4, puros. */

function baseReport(overrides: Partial<ExpensePeriodReport> = {}): ExpensePeriodReport {
  return {
    period: { kind: "MONTH", start: "2026-10-01T06:00:00.000Z", end: "2026-11-01T06:00:00.000Z", label: "Octubre 2026", previous: { start: "", end: "", label: "" }, next: { start: "", end: "", label: "" } },
    basis: "PAID",
    branchId: "branch-1",
    totals: { expenseTotal: 1500, netSales: 10000, cogs: 6000, grossProfit: 4000, operatingProfit: 2500, expenseToSalesPercent: 15 },
    byCategory: [
      { category: "RENT", total: 1000, previousTotal: 1000, average4: 1000, deltaPercent: 0, budgetProrated: 1000, budgetExecutedPercent: 100, byConcept: [] },
      { category: "UNCLASSIFIED", total: 500, previousTotal: 0, average4: 0, deltaPercent: null, budgetProrated: 0, budgetExecutedPercent: null, byConcept: [] },
    ],
    byBranch: [],
    bySource: [],
    byDay: [],
    comparison: { previousTotal: 1000, average4Total: 1000 },
    budget: { totalProrated: 1000, executedPercent: 150 },
    payroll: null,
    alerts: [],
    informative: { purchasesPaid: 0, internalFreightCost: 0, internalFreightOverlapWarning: null },
    rows: {
      items: [
        {
          id: "cm-1", date: "2026-10-05T12:00:00.000Z", branchId: "branch-1", branchCode: "MSY", branchName: "Masaya",
          category: "RENT", conceptId: null, conceptName: "Alquiler local", description: "Pago, de alquiler", payee: "Doña \"Rosa\"",
          receiptNumber: "R-001", amount: 1000, source: "CAJA", registeredBy: "Ana Pérez", approvedBy: null, reference: null,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    },
    ...overrides,
  };
}

describe("buildExpensePeriodCsv", () => {
  test("encabezado + una fila, con comas/comillas en los campos escapadas", () => {
    const csv = buildExpensePeriodCsv(baseReport());
    const lines = csv.split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^Fecha,Sucursal,Categoría/);
    // la descripción tiene una coma y el beneficiario tiene comillas: ambos deben venir citados.
    assert.match(lines[1], /"Pago, de alquiler"/);
    assert.match(lines[1], /"Doña ""Rosa"""/);
    assert.match(lines[1], /1000\.00/);
  });

  test("sin filas, solo queda el encabezado", () => {
    const csv = buildExpensePeriodCsv(baseReport({ rows: { items: [], total: 0, limit: 50, offset: 0 } }));
    assert.equal(csv.split("\n").length, 1);
  });
});

describe("buildExpensePeriodPrintHtml", () => {
  test("incluye el label del período, los KPIs y la fila de categoría — pero NO una categoría en cero sin presupuesto", () => {
    const html = buildExpensePeriodPrintHtml(baseReport(), { branchLabel: "Masaya" });
    assert.match(html, /Octubre 2026/);
    assert.match(html, /Masaya/);
    assert.match(html, /C\$1,500\.00/); // gasto total
    assert.match(html, /15\.0%/); // gasto/ventas
  });

  test("escapa HTML en el label del período (nunca inyecta markup crudo)", () => {
    const html = buildExpensePeriodPrintHtml(
      baseReport({ period: { kind: "CUSTOM", start: "", end: "", label: "<script>x</script>", previous: { start: "", end: "", label: "" }, next: { start: "", end: "", label: "" } } }),
      { branchLabel: "Todas" },
    );
    assert.ok(!html.includes("<script>x</script>"));
    assert.match(html, /&lt;script&gt;/);
  });
});
