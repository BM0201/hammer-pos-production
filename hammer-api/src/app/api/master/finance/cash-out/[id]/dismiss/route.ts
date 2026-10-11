import { z } from "zod";
import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { isMaster } from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";
import { dismissCashOutAsNotExpense } from "@/modules/finance/cash-out-classification";

const dismissSchema = z.object({
  note: z.string().trim().min(3),
});

/** POST /api/master/finance/cash-out/[id]/dismiss — NO es un gasto: lo marca revisado, la alerta no vuelve a mostrarlo. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session)) return fail("FORBIDDEN", "Solo Master puede revisar retiros de caja.", 403);
    await requireCsrf(request, session);

    const { id } = await params;
    const body = await request.json();
    const parsed = dismissSchema.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_ERROR", "Se requiere un motivo (mínimo 3 caracteres).", 400, parsed.error.flatten());

    const movement = await dismissCashOutAsNotExpense(id, parsed.data.note, session!.userId);
    return ok(movement);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
