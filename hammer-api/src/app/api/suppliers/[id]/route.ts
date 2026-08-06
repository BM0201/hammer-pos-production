import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { disableSupplier, getSupplier, updateSupplier } from "@/modules/suppliers/service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    const { id } = await context.params;
    return ok(await getSupplier(id));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);
    const { id } = await context.params;
    return ok(await updateSupplier(id, await request.json().catch(() => ({})), session.userId));
  } catch (error) {
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
    return ok(await disableSupplier(id, session.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
