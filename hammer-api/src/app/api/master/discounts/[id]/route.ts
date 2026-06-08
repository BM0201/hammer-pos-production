import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { getDiscount, updateDiscount, deleteDiscount } from "@/modules/discounts/service";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    const { id } = await context.params;
    const data = await getDiscount(id);
    return ok(data);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);
    const { id } = await context.params;
    const body = await request.json();
    const data = await updateDiscount(id, body, session.userId);
    return ok(data);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);
    const { id } = await context.params;
    await deleteDiscount(id, session.userId);
    return ok({ message: "Descuento eliminado" });
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
