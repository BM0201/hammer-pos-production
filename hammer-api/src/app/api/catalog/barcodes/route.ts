import { ProductBarcodeKind } from "@prisma/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { parseListLimit } from "@/lib/api/list-limit";
import { searchBarcodes, listAllBarcodesForExport, type BarcodeSearchRow } from "@/modules/catalog/barcode-search-service";
import { toCsv } from "@/modules/reports/serializers";
import { csvReportResponse } from "@/modules/reports/http";
import type { BarcodeIssue } from "@/modules/catalog/barcode-issues";

const KINDS = ["FACTORY", "INTERNAL", "SUPPLIER"] as const;
const ISSUES = ["CHECKSUM_INVALID", "PRODUCT_INACTIVE", "PRODUCT_MERGED", "MULTIPLE_CODES", "INTERNAL_SKU_MISMATCH", "NO_PRIMARY"] as const;

const CSV_COLUMNS = ["codigo", "tipo", "principal", "producto", "sku", "activo", "unificado", "total_codigos", "problemas"];

function toCsvRow(row: BarcodeSearchRow): Record<string, unknown> {
  return {
    codigo: row.code,
    tipo: row.kind,
    principal: row.isPrimary ? "si" : "no",
    producto: row.product.name,
    sku: row.product.sku,
    activo: row.product.isActive ? "si" : "no",
    unificado: row.product.isMerged ? "si" : "no",
    total_codigos: row.product.barcodeCount,
    problemas: row.issues.join(";"),
  };
}

/**
 * GET /api/catalog/barcodes?q&kind&issue&cursor&limit&format
 *
 * prompt-codigos-editar-eliminar.md Fase 1.3 — lista general de códigos
 * para limpiar en lote, con filtros por tipo y "problema" (issue), y
 * `format=csv` para exportar el set COMPLETO que coincide con los filtros.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() || undefined;
    const kindRaw = url.searchParams.get("kind");
    const kind = kindRaw && (KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as ProductBarcodeKind) : undefined;
    const issueRaw = url.searchParams.get("issue");
    const issue = issueRaw && (ISSUES as readonly string[]).includes(issueRaw) ? (issueRaw as BarcodeIssue) : undefined;
    if (kindRaw && !kind) return fail("VALIDATION_ERROR", "kind inválido.", 400);
    if (issueRaw && !issue) return fail("VALIDATION_ERROR", "issue inválido.", 400);

    if (url.searchParams.get("format") === "csv") {
      const rows = await listAllBarcodesForExport({ q, kind, issue });
      return csvReportResponse("codigos-de-barra.csv", toCsv(CSV_COLUMNS, rows.map(toCsvRow)));
    }

    const limit = parseListLimit(url.searchParams.get("limit"), { default: 50, max: 200 });
    const cursor = url.searchParams.get("cursor") ?? undefined;
    return ok(await searchBarcodes({ q, kind, issue, cursor, limit }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
