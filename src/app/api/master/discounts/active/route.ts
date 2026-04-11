import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertBranchAccess } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { getActiveDiscountsForBranch } from "@/modules/discounts/service";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId");
    if (!branchId) {
      return NextResponse.json({ message: "branchId is required" }, { status: 400 });
    }
    // Verify the user has access to the requested branch
    assertBranchAccess(session, branchId);
    const data = await getActiveDiscountsForBranch(branchId);
    return NextResponse.json({ data });
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
