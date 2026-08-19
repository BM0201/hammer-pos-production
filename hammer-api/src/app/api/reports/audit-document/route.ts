import { NextResponse } from "next/server";
import { resolveReportRequest } from "@/modules/reports/http";
import { buildAuditDocumentPdf, type AuditDocumentSection } from "@/modules/reports/pdf";
import { getReportDefinition } from "@/modules/reports/report-definitions";
import {
  getSalesReportRows,
  getSalesByCategoryReportRows,
  getInventoryMovementsReportRows,
  getPaymentsReportRows,
} from "@/modules/reports/service";
import { toHttpErrorResponse } from "@/lib/http";

// CAMBIO 5 (prompt-reportes-v2): documento único de rango largo (mes X a mes
// Y), constructor de secciones — cada sección reusa su propio reporte ya
// existente (mismas funciones de reports/service.ts que /api/reports/*),
// nunca una query paralela. El PDF se arma con buildAuditDocumentPdf, que
// reusa el mismo render de sección que cada reporte individual (pdf.ts).
const SECTION_KEYS = [
  "sales-detail",
  "sales-category",
  "inventory-ingresos",
  "inventory-envios",
  "inventory-conteos",
  "payments",
] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

const SECTION_LABEL: Record<SectionKey, string> = {
  "sales-detail": "Ventas con detalle",
  "sales-category": "Ventas por categoría",
  "inventory-ingresos": "Ingresos de materiales",
  "inventory-envios": "Envíos / traslados",
  "inventory-conteos": "Conteos y ajustes",
  payments: "Cobros y métodos de pago",
};

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) return resolved.error;

    const { searchParams } = new URL(request.url);
    const rawSections = (searchParams.get("sections") ?? SECTION_KEYS.join(",")).split(",").map((s) => s.trim());
    const selected = new Set(rawSections.filter((key): key is SectionKey => (SECTION_KEYS as readonly string[]).includes(key)));

    const baseFilters = {
      branchIds: resolved.branchIds,
      dateFrom: resolved.query.dateFrom,
      dateTo: resolved.query.dateTo,
    };

    const sections: AuditDocumentSection[] = [];

    if (selected.has("sales-detail")) {
      const { rows, totalCount } = await getSalesReportRows(baseFilters);
      sections.push({ label: SECTION_LABEL["sales-detail"], reportDefinition: getReportDefinition("sales"), rows, totalRowCount: totalCount });
    }
    if (selected.has("sales-category")) {
      const rows = await getSalesByCategoryReportRows(baseFilters);
      sections.push({ label: SECTION_LABEL["sales-category"], reportDefinition: getReportDefinition("sales-by-category"), rows });
    }
    if (selected.has("inventory-ingresos")) {
      const { rows, totalCount } = await getInventoryMovementsReportRows({ ...baseFilters, group: "ingresos" });
      sections.push({ label: SECTION_LABEL["inventory-ingresos"], reportDefinition: getReportDefinition("inventory-movements"), rows, totalRowCount: totalCount });
    }
    if (selected.has("inventory-envios")) {
      const { rows, totalCount } = await getInventoryMovementsReportRows({ ...baseFilters, group: "envios" });
      sections.push({ label: SECTION_LABEL["inventory-envios"], reportDefinition: getReportDefinition("inventory-movements"), rows, totalRowCount: totalCount });
    }
    if (selected.has("inventory-conteos")) {
      const { rows, totalCount } = await getInventoryMovementsReportRows({ ...baseFilters, group: "conteos" });
      sections.push({ label: SECTION_LABEL["inventory-conteos"], reportDefinition: getReportDefinition("inventory-movements"), rows, totalRowCount: totalCount });
    }
    if (selected.has("payments")) {
      const { rows, totalCount } = await getPaymentsReportRows(baseFilters);
      sections.push({ label: SECTION_LABEL.payments, reportDefinition: getReportDefinition("payments"), rows, totalRowCount: totalCount });
    }

    const pdf = buildAuditDocumentPdf({
      businessName: "Hammer POS",
      rangeLabel: `${resolved.dateFromLabel ?? "sin límite"} – ${resolved.dateToLabel ?? "sin límite"}`,
      branchLabel: resolved.branchLabel ?? "Todas las sucursales",
      generatedBy: resolved.generatedBy,
      sections,
    });

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename=\"documento-auditoria.pdf\"",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
