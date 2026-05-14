import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { dispatchListSchema } from "@/modules/dispatch/validators";
import { listDispatchHistory, logDispatchDenied } from "@/modules/dispatch/service";
import { toHttpErrorResponse } from "@/lib/http";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const parsed = dispatchListSchema.safeParse({ branchId: searchParams.get("branchId") ?? undefined });
    if (!parsed.success) {
      return NextResponse.json({ message: "Invalid query", issues: parsed.error.issues }, { status: 400 });
    }

    const branchId = parsed.data.branchId ?? "";

    if (!canInAnyAssignedBranch(session, CAPABILITIES.DISPATCH_VIEW)) {
      await logDispatchDenied({
        actorUserId: session.userId,
        branchId: branchId || undefined,
        entityId: "dispatch-history",
        reason: "FORBIDDEN_ROLE",
        metadata: { role: session.roleCode },
      });
      return NextResponse.json({ message: "Forbidden", reason: "FORBIDDEN_ROLE" }, { status: 403 });
    }

    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.DISPATCH_VIEW)) {
      await logDispatchDenied({
        actorUserId: session.userId,
        branchId,
        entityId: "dispatch-history",
        reason: "FORBIDDEN_BRANCH",
      });
      return NextResponse.json({ message: "Forbidden", reason: "FORBIDDEN_BRANCH" }, { status: 403 });
    }

    const data = await listDispatchHistory({
      branchId,
      includeAllBranches: isMaster(session) && !branchId,
    });

    return NextResponse.json({ data });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
