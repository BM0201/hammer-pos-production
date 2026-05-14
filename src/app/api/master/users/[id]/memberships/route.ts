import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { upsertMembership } from "@/modules/users/service";
import { upsertMembershipSchema } from "@/modules/users/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const parsed = upsertMembershipSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Datos inválidos.", issues: parsed.error.issues }, { status: 400 });
    }

    const membership = await upsertMembership({
      userId: id,
      branchId: parsed.data.branchId,
      roleCode: parsed.data.roleCode,
      isActive: parsed.data.isActive,
    });

    return NextResponse.json({ data: membership }, { status: 201 });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
