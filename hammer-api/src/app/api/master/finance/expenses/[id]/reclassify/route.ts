import { z } from "zod";
import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { isMaster } from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";
import { EXPENSE_CATEGORIES } from "@/modules/pricing/validators";
import { reclassifyExpenseCategory } from "@/modules/finance/expense-reclassification";

const reclassifySchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  conceptId: z.string().cuid().optional().nullable(),
});

/** POST /api/master/finance/expenses/[id]/reclassify — solo Master/Owner. Nunca cambia monto, fecha ni el movimiento de caja: solo category/conceptId. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session)) return fail("FORBIDDEN", "Solo Master puede reclasificar gastos.", 403);
    await requireCsrf(request, session);

    const { id } = await params;
    const parsed = reclassifySchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    const expense = await reclassifyExpenseCategory(id, { category: parsed.data.category, conceptId: parsed.data.conceptId ?? null }, session!.userId);
    return ok(expense);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
