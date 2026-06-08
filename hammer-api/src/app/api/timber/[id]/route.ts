import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { getTimberProduct, updateTimberProduct, deleteTimberProduct } from "@/modules/timber/service";
import { updateTimberProductSchema } from "@/modules/timber/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { z } from "zod";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

type Params = { params: Promise<{ id: string }> };

/** GET /api/timber/[id] — Get a specific timber product */
export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    const { id } = await params;

    const result = await getTimberProduct(id);
    if (!result) {
      return fail("ERROR", "Producto de madera no encontrado", 404);
    }
    return ok(result);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}

/** PUT /api/timber/[id] — Update a timber product */
export async function PUT(request: Request, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    const { id } = await params;

    if (!isMaster(session)) {
      return fail("ERROR", "Solo MASTER puede editar productos de madera", 403);
    }

    const body = await request.json();
    const parsed = updateTimberProductSchema.parse(body);
    const result = await updateTimberProduct(id, parsed);

    return ok(result);
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return fail("VALIDATION_ERROR", "Validación fallida", 422);
    }
    if (err instanceof Error && err.message === "TIMBER_PRODUCT_NOT_FOUND") {
      return fail("ERROR", "Producto de madera no encontrado", 404);
    }
    return toHttpErrorResponse(err);
  }
}

/** DELETE /api/timber/[id] — Delete (deactivate) a timber product */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    const { id } = await params;

    if (!isMaster(session)) {
      return fail("ERROR", "Solo MASTER puede eliminar productos de madera", 403);
    }

    const result = await deleteTimberProduct(id);
    return ok(result);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "TIMBER_PRODUCT_NOT_FOUND") {
      return fail("ERROR", "Producto de madera no encontrado", 404);
    }
    return toHttpErrorResponse(err);
  }
}
