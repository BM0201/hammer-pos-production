import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { toHttpErrorResponse } from "@/lib/http";

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        userId: session.userId,
        username: session.username,
        globalRoles: session.globalRoles,
        branchMemberships: session.branchMemberships,
        primaryBranchId: session.primaryBranchId,
        roleCode: session.roleCode,
        branchIds: session.branchIds,
      },
    });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
