import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReportPdf, buildAuditDocumentPdf } from "@/modules/reports/pdf";
import { getReportDefinition, REPORT_ROW_CAP } from "@/modules/reports/report-definitions";

// CAMBIO 1 (prompt-reportes-v2): "sales" ahora es detalle por línea — fecha/
// orden/producto/categoria/costo/margen, ya no estado/vendedor/total plano.
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
        orden: "V-4471",
        producto_sku: "CEM-GRIS",
        producto_nombre: "Cemento gris 42.5kg",
        categoria: "Construccion",
        cantidad: "40",
        precio_unitario: "438.00",
        costo_unitario: "415.00",
        costo_total: "16600.00",
        subtotal: "17520.00",
        margen_monto: "920.00",
        margen_porcentaje: "5.3",
        costo_fuente: "",
        vendedor: "admin",
      },
    ],
  });

  const text = pdf.toString("utf8");
  assert.equal(pdf.subarray(0, 8).toString("utf8"), "%PDF-1.4");
  assert.match(text, /Reporte de Ventas/);
  assert.match(text, /Resumen ejecutivo/);
  assert.match(text, /Filtros aplicados/);
  assert.match(text, /Totales/);
  assert.match(text, /C\$/);
  assert.match(text, /Cemento gris/);
  assert.match(text, /11\/06\/2026/);
  assert.doesNotMatch(text, /2026-06-11T12:00:00.000Z/);
  assert.match(text, /Pagina 1 de 1/);
  assert.match(text, /startxref/);
});

test("reports: sales PDF uses explicit columns and warns on row limits (N de M, nunca truncado callado)", () => {
  const pdf = buildReportPdf({
    reportDefinition: getReportDefinition("sales"),
    generatedAt: new Date("2026-06-11T12:00:00.000Z"),
    // CAMBIO 5: totalRowCount real (via count()) distinto de rows.length —
    // el aviso debe decir "N de M", nunca repetir N como si fuera M.
    totalRowCount: REPORT_ROW_CAP,
    rows: [
      {
        fecha: "2026-06-11T12:00:00.000Z",
        sucursal_codigo: "MGA",
        orden: "V-4471",
        producto_sku: "CEM-GRIS",
        producto_nombre: "Cemento gris 42.5kg",
        categoria: "Construccion",
        cantidad: "40",
        subtotal: "17520.00",
        margen_porcentaje: "5.3",
        extra_technical_column: "should not drive columns",
      },
    ],
  });

  const text = pdf.toString("utf8");
  assert.match(text, new RegExp(`Mostrando 1 de ${REPORT_ROW_CAP} filas`));
  assert.doesNotMatch(text, /extra_technical_column/);
});

// CAMBIO 5 (prompt-reportes-v2): documento de auditoría multi-mes — portada +
// secciones, cada una reusando su propio reporte ya existente.
test("reports: buildAuditDocumentPdf assembles a cover page + one page per section, same PDF pipeline", () => {
  const pdf = buildAuditDocumentPdf({
    businessName: "Ferreteria Hammer",
    rangeLabel: "Enero - Junio 2026",
    branchLabel: "Todas las sucursales",
    generatedBy: "bayardom",
    generatedAt: new Date("2026-07-27T12:00:00.000Z"),
    sections: [
      {
        label: "Ventas con detalle",
        reportDefinition: getReportDefinition("sales"),
        rows: [
          {
            fecha: "2026-02-04T12:00:00.000Z",
            sucursal_codigo: "MGA",
            orden: "V-4471",
            producto_sku: "CEM-GRIS",
            producto_nombre: "Cemento gris 42.5kg",
            categoria: "Construccion",
            cantidad: "40",
            subtotal: "17520.00",
            costo_total: "16600.00",
            margen_monto: "920.00",
            margen_porcentaje: "5.3",
          },
        ],
        totalRowCount: 1,
      },
      {
        label: "Ventas por categoria",
        reportDefinition: getReportDefinition("sales-by-category"),
        rows: [
          { categoria: "Construccion", ingreso: "183960.00", costo: "174300.00", margen_porcentaje: "5.3", porcentaje_total: "51.5", ordenes: "12" },
        ],
      },
    ],
  });

  const text = pdf.toString("utf8");
  assert.equal(pdf.subarray(0, 8).toString("utf8"), "%PDF-1.4");
  assert.match(text, /Documento de Auditoria/);
  assert.match(text, /Contenido/);
  assert.match(text, /Ventas con detalle/);
  assert.match(text, /Ventas por categoria/);
  assert.match(text, /Ingreso del periodo/);
  assert.match(text, /Margen bruto del periodo/);
  assert.match(text, /Cemento gris/);
  // Portada + 1 pagina por seccion como minimo (2 secciones -> al menos 3 paginas).
  assert.match(text, /Pagina 3 de 3|Pagina [3-9] de [3-9]/);
  assert.match(text, /startxref/);
});
