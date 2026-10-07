import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { addLines, removeLines, updateLines } from "@/modules/pricing/price-update-batch-service";

/**
 * prompt-carga-precios.md Fase 1 — agrega, quita o edita líneas de un
 * borrador. Los tres son opcionales e independientes en el mismo body
 * (la planilla de la Fase 3 usa `update` para el autoguardado por fila;
 * `add`/`remove` para armar la carga desde la Bandeja/Precios vigentes).
 * Solo funciona con la carga en DRAFT — si no, 409 (ALREADY_PROCESSED).
 */
const linesPatchSchema = z.object({
  add: z
    .array(
      z.object({
        productId: z.string().cuid(),
        newPrice: z.number().positive().optional().nullable(),
        trayDecisionId: z.string().cuid().optional().nullable(),
      }),
    )
    .optional(),
  remove: z.array(z.string().cuid()).optional(),
  update: z
    .array(
      z.object({
        lineId: z.string().cuid(),
        newPrice: z.number().positive().nullable(),
      }),
    )
    .optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_EDIT_GLOBAL)) {
      return fail("FORBIDDEN", "No tienes permiso para editar cargas de precios.", 403);
    }

    const { id } = await context.params;
    const parsed = linesPatchSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload inválido.", 400, parsed.error.flatten());

    const result: { added?: number; removed?: number; updated?: number } = {};
    if (parsed.data.add?.length) {
      result.added = (await addLines(id, parsed.data.add, session.userId)).added;
    }
    if (parsed.data.remove?.length) {
      result.removed = (await removeLines(id, parsed.data.remove)).removed;
    }
    if (parsed.data.update?.length) {
      result.updated = (await updateLines(id, parsed.data.update)).updated;
    }

    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
