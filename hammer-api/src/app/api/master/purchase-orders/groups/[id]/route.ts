import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canInBranch } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { getPurchaseOrderGroup, updatePurchaseOrderGroupLines } from "@/modules/purchase-orders/group-service";

const lineSchema = z.object({
  productId: z.string().min(1),
  unitCostBeforeTax: z.number().min(0),
  taxRate: z.number().min(0).optional(),
  unitTaxAmount: z.number().min(0).optional(),
  quantity: z.number().positive(),
  overrides: z.record(z.string(), z.number().min(0)).optional(),
});

const updateSchema = z.object({ lines: z.array(lineSchema).min(1) });

/** GET /api/master/purchase-orders/groups/[id] — matriz producto × sucursal con pedido/recibido/pendiente. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { id } = await params;
    return ok(await getPurchaseOrderGroup(id));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

/** PATCH /api/master/purchase-orders/groups/[id] — edita líneas, solo si TODAS las órdenes siguen DRAFT. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    const group = await getPurchaseOrderGroup(id);
    const deniedBranches = group.orders.filter((o) => !canInBranch(session, o.branchId, CAPABILITIES.PURCHASES_CREATE));
    if (deniedBranches.length > 0) {
      return fail("FORBIDDEN", `No tienes permiso para editar compras en: ${deniedBranches.map((o) => o.branch.name).join(", ")}.`, 403);
    }

    return ok(await updatePurchaseOrderGroupLines(id, parsed.data));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
