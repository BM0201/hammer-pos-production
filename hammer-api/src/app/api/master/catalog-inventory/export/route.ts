import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { buildCatalogExportWorkbook } from "@/modules/catalog-inventory/export-service";

/** Catálogo completo en .xlsx — base64 dentro del JSON, igual que master/pricing/current/export. */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { buffer, rowCount } = await buildCatalogExportWorkbook();
    const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "America/Managua" });
    return ok({
      filename: `catalogo-completo-${ymd}.xlsx`,
      base64: Buffer.from(buffer).toString("base64"),
      rowCount,
    });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
