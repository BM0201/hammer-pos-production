import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReportPdf } from "@/modules/reports/pdf";

test("reports: buildReportPdf returns a downloadable PDF payload", () => {
  const pdf = buildReportPdf({
    title: "reporte-ventas",
    generatedAt: new Date("2026-06-11T12:00:00.000Z"),
    rows: [{ fecha: "2026-06-11", sucursal_codigo: "MGA", total: "100.00" }],
  });

  assert.equal(pdf.subarray(0, 8).toString("utf8"), "%PDF-1.4");
  assert.match(pdf.toString("utf8"), /reporte-ventas/);
  assert.match(pdf.toString("utf8"), /startxref/);
});
