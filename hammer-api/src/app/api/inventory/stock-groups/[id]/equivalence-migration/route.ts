import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import {
  previewEquivalentStockGroupMigration,
  applyEquivalentStockGroupMigration,
  MIGRATION_RESOLUTIONS,
  type ApplyResolution,
} from "@/modules/catalog/equivalent-stock-migration";

// GET → preview por sucursal (no muta nada): cómo quedaría el stock bajo cada
// resolución, qué recomienda y si hay conflicto (posible doble conteo).
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id } = await context.params;
    return ok(await previewEquivalentStockGroupMigration(id));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

// POST → aplica la resolución elegida. Reinterpreta el inventario sin sumar
// (salvo SUM_BOTH explícito) y deja los derivados en cero físico.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      resolution?: string;
      manualBaseQtyByBranch?: Record<string, number>;
      reason?: string;
    };

    const resolution = body.resolution as ApplyResolution | undefined;
    const valid = resolution === "RECOMMENDED" || (resolution && (MIGRATION_RESOLUTIONS as readonly string[]).includes(resolution));
    if (!valid) {
      return fail(
        "VALIDATION_ERROR",
        `resolution inválida. Use una de: RECOMMENDED, ${MIGRATION_RESOLUTIONS.join(", ")}.`,
        400,
      );
    }
    if (resolution === "CANCEL") {
      return fail("VALIDATION_ERROR", "CANCEL no aplica cambios.", 400);
    }

    const results = await applyEquivalentStockGroupMigration({
      stockGroupId: id,
      actorUserId: session.userId,
      conflictResolution: resolution as ApplyResolution,
      manualBaseQtyByBranch: body.manualBaseQtyByBranch,
      reason: body.reason ?? "manual equivalence migration",
    });

    return ok({ ok: true, branches: results });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
