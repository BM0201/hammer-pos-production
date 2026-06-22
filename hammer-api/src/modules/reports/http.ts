import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canExportReports, resolveReportBranchScope } from "@/modules/reports/access";
import { buildReportPdf } from "@/modules/reports/pdf";
import { getReportDefinition } from "@/modules/reports/report-definitions";
import { formatDateLocal, formatStatus, safeText } from "@/modules/reports/report-formatters";
import { reportQuerySchema } from "@/modules/reports/validators";

export async function resolveReportRequest(request: Request) {
  const session = await getCurrentSession();
  assertAuthenticated(session);
  if (!canExportReports(session)) {
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

    return {
      query: parsed.data,
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
    generatedBy?: string;
    branchLabel?: string;
  },
  filename: string,
  csv: string,
  rows: Array<Record<string, unknown>>,
  reportKey?: string,
) {
  const generatedAt = new Date();
  if (request.format === "json") {
    return NextResponse.json(
      { rows, count: rows.length, generatedAt: generatedAt.toISOString() },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }
  if (request.format === "pdf") {
    const definition = getReportDefinition(reportKey ?? filename.replace(/^reporte-/i, "").replace(/\.csv$/i, ""));
    const filters = [
      { label: "Desde", value: request.query?.dateFrom ? formatDateLocal(request.query.dateFrom) : "Sin limite" },
      { label: "Hasta", value: request.query?.dateTo ? formatDateLocal(request.query.dateTo) : "Sin limite" },
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
      totalRowCount: rows.length,
      options: { filename },
    });
    return new NextResponse(pdf, {
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
