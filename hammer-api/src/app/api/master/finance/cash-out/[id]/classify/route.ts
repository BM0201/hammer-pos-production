import { z } from "zod";
import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { isMaster } from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";
import { EXPENSE_CATEGORIES } from "@/modules/pricing/validators";
import { classifyCashOutAsExpense } from "@/modules/finance/cash-out-classification";

const classifySchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  conceptId: z.string().cuid().optional().nullable(),
  payee: z.string().max(160).optional().nullable(),
  receiptNumber: z.string().max(80).optional().nullable(),
  description: z.string().max(200).optional().nullable(),
});

/** POST /api/master/finance/cash-out/[id]/classify — SÍ es un gasto: liga un OperatingExpense PAID y vuelve EXPENSE_OUT el movimiento. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session)) return fail("FORBIDDEN", "Solo Master puede clasificar retiros de caja.", 403);
    await requireCsrf(request, session);

    const { id } = await params;
    const body = await request.json();
    const parsed = classifySchema.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    const expense = await classifyCashOutAsExpense(id, parsed.data, session!.userId);
    return ok(expense);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
