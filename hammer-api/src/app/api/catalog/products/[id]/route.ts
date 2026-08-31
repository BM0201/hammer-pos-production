import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { updateProduct, deleteOrDeactivateProduct } from "@/modules/catalog/service";
import { updateProductSchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { WacValidationError } from "@/modules/inventory/wac";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const parsed = updateProductSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    const product = await updateProduct(id, { ...parsed.data, actorUserId: session.userId });
    return ok(product);
  } catch (error) {
    // "asegura el motor de mejor manera" — mismo patrón que
    // /api/inventory/movements (WacValidationError), pero con su propio
    // `code` (no el genérico VALIDATION_ERROR) para que el frontend pueda
    // distinguir esta sospecha específica y ofrecer el reintento con
    // allowHighUnitCost.
    if (error instanceof WacValidationError) {
      return fail(error.code, error.message, 422);
    }
    return toHttpErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const result = await deleteOrDeactivateProduct(id, session.userId);
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
