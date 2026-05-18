import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { toHttpErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    // Fetch mustChangePassword from DB so the frontend can enforce the redirect
    let mustChangePassword = false;
    try {
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { mustChangePassword: true },
      });
      mustChangePassword = user?.mustChangePassword ?? false;
    } catch {
      // If DB is unavailable degrade gracefully
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
        mustChangePassword,
      },
    });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
