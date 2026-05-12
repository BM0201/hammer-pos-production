import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { createUser, listBranchesForMembershipManagement, listUsersWithMemberships } from "@/modules/users/service";
import { createUserSchema } from "@/modules/users/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const [users, branches] = await Promise.all([
      listUsersWithMemberships(),
      listBranchesForMembershipManagement(),
    ]);

    return NextResponse.json({ data: { users, branches } });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const parsed = createUserSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Datos inválidos.", issues: parsed.error.issues }, { status: 400 });
    }

    const created = await createUser(parsed.data);
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
