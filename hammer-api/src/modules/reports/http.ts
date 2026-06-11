import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canExportReports, resolveReportBranchScope } from "@/modules/reports/access";
import { buildReportPdf } from "@/modules/reports/pdf";
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
    return { query: parsed.data, branchIds, format };
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
  request: { format: "csv" | "json" | "pdf" },
  filename: string,
  csv: string,
  rows: Array<Record<string, unknown>>,
) {
  if (request.format === "json") {
    return NextResponse.json(
      { rows, count: rows.length, generatedAt: new Date().toISOString() },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }
  if (request.format === "pdf") {
    const pdf = buildReportPdf({ title: filename.replace(/\.csv$/i, ""), rows });
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
