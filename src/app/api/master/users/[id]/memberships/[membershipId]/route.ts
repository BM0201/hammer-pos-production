import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { removeMembershipFromUser, updateMembership } from "@/modules/users/service";
import { updateMembershipSchema } from "@/modules/users/validators";
import { toHttpErrorResponse } from "@/lib/http";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; membershipId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id, membershipId } = await context.params;
    const parsed = updateMembershipSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Datos inválidos.", issues: parsed.error.issues }, { status: 400 });
    }

    const membership = await updateMembership(id, membershipId, parsed.data);
    return NextResponse.json({ data: membership });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; membershipId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id, membershipId } = await context.params;
    await removeMembershipFromUser(id, membershipId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
