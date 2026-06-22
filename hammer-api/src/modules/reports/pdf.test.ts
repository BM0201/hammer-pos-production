import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReportPdf } from "@/modules/reports/pdf";
import { getReportDefinition } from "@/modules/reports/report-definitions";

test("reports: buildReportPdf returns a downloadable PDF payload", () => {
  const pdf = buildReportPdf({
    title: "Reporte de Ventas",
    reportDefinition: getReportDefinition("sales"),
    generatedAt: new Date("2026-06-11T12:00:00.000Z"),
    generatedBy: "admin",
    filters: [
      { label: "Desde", value: "11/06/2026 06:00 am" },
      { label: "Sucursal", value: "MGA - Central" },
    ],
    rows: [
      {
        fecha: "2026-06-11T12:00:00.000Z",
        sucursal_codigo: "MGA",
        sucursal_nombre: "Central",
        orden: "ORD-2026-0000000001",
        estado: "POSTED",
        vendedor: "admin",
        total: "1234.56",
      },
    ],
  });

  const text = pdf.toString("utf8");
  assert.equal(pdf.subarray(0, 8).toString("utf8"), "%PDF-1.4");
  assert.match(text, /Reporte de Ventas/);
  assert.match(text, /Resumen ejecutivo/);
  assert.match(text, /Filtros aplicados/);
  assert.match(text, /Total/);
  assert.match(text, /C\$/);
  assert.match(text, /Cobrado/);
  assert.match(text, /11\/06\/2026/);
  assert.doesNotMatch(text, /2026-06-11T12:00:00.000Z/);
  assert.match(text, /Pagina 1 de 1/);
  assert.match(text, /startxref/);
});

test("reports: sales PDF uses explicit columns and warns on row limits", () => {
  const pdf = buildReportPdf({
    reportDefinition: getReportDefinition("sales"),
    generatedAt: new Date("2026-06-11T12:00:00.000Z"),
    totalRowCount: 2000,
    rows: [
      {
        fecha: "2026-06-11T12:00:00.000Z",
        sucursal_codigo: "MGA",
        sucursal_nombre: "Central",
        orden: "ORD-2026-0000000001",
        estado: "POSTED",
        vendedor: "admin",
        total: "1234.56",
        extra_technical_column: "should not drive columns",
      },
    ],
  });

  const text = pdf.toString("utf8");
  assert.match(text, /Mostrando 1 filas por limite operativo/);
  assert.doesNotMatch(text, /extra_technical_column/);
});
