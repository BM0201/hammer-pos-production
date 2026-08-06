import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { removeMembershipFromUser, updateMembership } from "@/modules/users/service";
import { updateMembershipSchema } from "@/modules/users/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; membershipId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id, membershipId } = await context.params;
    const parsed = updateMembershipSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Datos inválidos.", 400);
    }

    const membership = await updateMembership(id, membershipId, parsed.data);
    return ok(membership);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; membershipId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id, membershipId } = await context.params;
    await removeMembershipFromUser(id, membershipId);
    return ok({ deleted: true });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
