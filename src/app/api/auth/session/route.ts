import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";

export async function GET() {
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
}
