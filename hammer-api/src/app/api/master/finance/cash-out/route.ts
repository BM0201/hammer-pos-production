import { z } from "zod";
import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { isMaster } from "@/modules/rbac/guards";
import { listUnclassifiedCashOuts } from "@/modules/finance/cash-out-classification";

const listSchema = z.object({
  start: z.coerce.date(),
  end: z.coerce.date(),
  branchId: z.string().cuid().optional().nullable(),
});

/**
 * GET /api/master/finance/cash-out?start=&end=&branchId= — retiros (CASH_OUT)
 * sin clasificar del período, los mismos que cuenta la alerta
 * UNCLASSIFIED_CASH_OUT de GET .../expenses/period (Fase 2.4). Master-only:
 * prompt-gastos-semana-quincena.md Fase 4 lo pide explícito.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session)) return fail("FORBIDDEN", "Solo Master puede clasificar retiros de caja.", 403);

    const url = new URL(request.url);
    const parsed = listSchema.safeParse({
      start: url.searchParams.get("start") ?? undefined,
      end: url.searchParams.get("end") ?? undefined,
      branchId: url.searchParams.get("branchId") ?? undefined,
    });
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    const rows = await listUnclassifiedCashOuts({ start: parsed.data.start, end: parsed.data.end, branchId: parsed.data.branchId ?? null });
    return ok(rows);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
