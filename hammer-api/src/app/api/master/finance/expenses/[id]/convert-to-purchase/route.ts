import { z } from "zod";
import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { isMaster } from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";
import { convertExpenseToCashPurchase } from "@/modules/finance/expense-reclassification";

const convertSchema = z.object({
  supplierName: z.string().max(160).optional().nullable(),
  kind: z.enum(["GOODS", "FREIGHT"]),
});

/** POST /api/master/finance/expenses/[id]/convert-to-purchase — "Era una compra de mercadería": sale del gasto operativo. Solo Master/Owner. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session)) return fail("FORBIDDEN", "Solo Master puede convertir un gasto en compra.", 403);
    await requireCsrf(request, session);

    const { id } = await params;
    const parsed = convertSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    const purchase = await convertExpenseToCashPurchase(id, parsed.data, session!.userId);
    return ok(purchase);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
