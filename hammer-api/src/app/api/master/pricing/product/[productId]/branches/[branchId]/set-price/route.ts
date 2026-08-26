import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { setBranchPriceException } from "@/modules/pricing/branch-price-exception-service";

const setPriceSchema = z.object({
  price: z.coerce.number().positive(),
  reason: z.string().min(3, "El motivo debe tener al menos 3 caracteres."),
});

/**
 * §3.5 (prompt-motor-precios-lote-herencia-gobierno.md) — declarar una
 * excepción de precio para esta sucursal, con motivo obligatorio. Sin
 * motivo, en seis meses nadie sabe si esa excepción sigue teniendo
 * sentido — es exactamente el problema que esta pantalla resuelve.
 */
export async function POST(request: Request, { params }: { params: Promise<{ productId: string; branchId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_EDIT_GLOBAL)) {
      return fail("FORBIDDEN", "No tienes permiso para editar precios.", 403);
    }

    const { productId, branchId } = await params;
    const parsed = setPriceSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const result = await setBranchPriceException({
      productId,
      branchId,
      price: parsed.data.price,
      reason: parsed.data.reason,
      actorUserId: session.userId,
    });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
