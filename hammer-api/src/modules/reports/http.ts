import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isFinanceUser } from "@/modules/rbac/guards";
import { canExportReports, resolveReportBranchScope } from "@/modules/reports/access";
import { buildReportPdf } from "@/modules/reports/pdf";
import { getReportDefinition } from "@/modules/reports/report-definitions";
import { formatStatus, safeText } from "@/modules/reports/report-formatters";
import { reportQuerySchema } from "@/modules/reports/validators";
import { getOperationalWindowForManaguaDate } from "@/modules/sales/realtime-sales-summary";

export async function resolveReportRequest(request: Request, options?: { requireFinance?: boolean }) {
  const session = await getCurrentSession();
  assertAuthenticated(session);
  if (!canExportReports(session)) {
    throw new Error("FORBIDDEN_REPORTS");
  }
  // Auditoría 2026-08-03: REPORTS_EXPORT por sí solo lo tiene BRANCH_ADMIN,
  // pero el resto del sistema trata nómina/salarios como exclusivo de
  // Finanzas (Master/Owner/SystemAdmin/Contador) — ver branch/expenses,
  // donde la categoría PAYROLL se oculta explícitamente a BRANCH_ADMIN, y
  // payroll/loans, que exige assertFinanceAccess. Los reportes de
  // nómina/préstamos de empleados deben exigir lo mismo.
  if (options?.requireFinance && !isFinanceUser(session)) {
    throw new Error("FORBIDDEN_REPORTS");
  }

  const { searchParams } = new URL(request.url);
  const parsed = reportQuerySchema.safeParse({
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
    branchId: searchParams.get("branchId") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    actorUsername: searchParams.get("actorUsername") ?? undefined,
  });

  if (!parsed.success) {
    return { error: NextResponse.json({ message: "Invalid query", issues: parsed.error.issues }, { status: 400 }) };
  }

  try {
    const branchIds = resolveReportBranchScope(session, parsed.data.branchId);
    const rawFormat = searchParams.get("format");
    const format: "csv" | "json" | "pdf" = rawFormat === "json" || rawFormat === "pdf" ? rawFormat : "csv";
    const selectedBranchId = parsed.data.branchId ?? (branchIds?.length === 1 ? branchIds[0] : undefined);
    const branch = selectedBranchId
      ? await prisma.branch.findUnique({ where: { id: selectedBranchId }, select: { code: true, name: true } })
      : null;

    // dateFrom/dateTo llegan como "YYYY-MM-DD" (día de negocio en Managua).
    // dateFrom = inicio de ESE día en Managua; dateTo = inicio del día
    // SIGUIENTE en Managua (límite exclusivo) — así un pago hecho a las
    // 20:00 Managua cae en el día correcto y no se corta a medianoche UTC.
    const dateFrom = parsed.data.dateFrom ? getOperationalWindowForManaguaDate(parsed.data.dateFrom).start : undefined;
    const dateTo = parsed.data.dateTo ? getOperationalWindowForManaguaDate(parsed.data.dateTo).end : undefined;

    return {
      query: { ...parsed.data, dateFrom, dateTo },
      dateFromLabel: parsed.data.dateFrom ?? null,
      dateToLabel: parsed.data.dateTo ?? null,
      branchIds,
      format,
      generatedBy: session.username,
      branchLabel: branch ? `${branch.code} - ${branch.name}` : "Todas las sucursales",
    };
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN_BRANCH") {
      return { error: NextResponse.json({ message: "Forbidden", reason: "FORBIDDEN_BRANCH" }, { status: 403 }) };
    }
    throw error;
  }
}

// dateFromLabel/dateToLabel son "YYYY-MM-DD" en calendario Managua — se
// formatean como texto puro, SIN pasar por Date/formatDateLocal (que
// interpretaría el string como instante UTC y correría el día hacia atrás).
function formatManaguaDateLabel(raw: string) {
  const [year, month, day] = raw.split("-");
  return `${day}/${month}/${year}`;
}

export function csvReportResponse(filename: string, csv: string) {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=\"${filename}\"`,
      "cache-control": "no-store",
    },
  });
}

export function reportResponse(
  request: {
    format: "csv" | "json" | "pdf";
    query?: {
      dateFrom?: Date;
      dateTo?: Date;
      branchId?: string;
      status?: string;
      actorUsername?: string;
    };
    dateFromLabel?: string | null;
    dateToLabel?: string | null;
    generatedBy?: string;
    branchLabel?: string;
  },
  filename: string,
  csv: string,
  rows: Array<Record<string, unknown>>,
  reportKey?: string,
  // CAMBIO 5 (prompt-reportes-v2): total REAL (via count()) cuando el
  // servicio lo calcula — antes esto siempre era rows.length, así que el
  // aviso de "límite operativo" nunca decía la verdad (N de N, nunca N de M).
  // Si el caller no lo pasa, se preserva el comportamiento anterior.
  totalRowCount?: number,
) {
  const generatedAt = new Date();
  const realTotal = totalRowCount ?? rows.length;
  if (request.format === "json") {
    return NextResponse.json(
      { rows, count: realTotal, generatedAt: generatedAt.toISOString() },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }
  if (request.format === "pdf") {
    const definition = getReportDefinition(reportKey ?? filename.replace(/^reporte-/i, "").replace(/\.csv$/i, ""));
    const filters = [
      { label: "Desde", value: request.dateFromLabel ? formatManaguaDateLabel(request.dateFromLabel) : "Sin limite" },
      { label: "Hasta", value: request.dateToLabel ? formatManaguaDateLabel(request.dateToLabel) : "Sin limite" },
      { label: "Sucursal", value: safeText(request.branchLabel, "Todas las sucursales") },
      { label: "Estado", value: request.query?.status ? formatStatus(request.query.status) : "Todos" },
      { label: "Usuario/Cajero", value: safeText(request.query?.actorUsername, "Todos") },
    ];
    const pdf = buildReportPdf({
      title: definition.title,
      rows,
      reportDefinition: definition,
      filters,
      generatedBy: request.generatedBy,
      generatedAt,
      totalRowCount: realTotal,
      options: { filename },
    });
    // Buffer<ArrayBufferLike> no matchea estructuralmente BodyInit en esta
    // versión de @types/node — Uint8Array sí (Buffer es un subtipo real).
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename=\"${filename.replace(/\.csv$/i, ".pdf")}\"`,
        "cache-control": "no-store",
      },
    });
  }
  return csvReportResponse(filename, csv);
}
