import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertBranchAccess } from "@/modules/auth/access";
import { listInventoryBalances } from "@/modules/inventory/service";
import { toHttpErrorResponse } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");
    const productId = searchParams.get("productId") ?? undefined;

    if (!branchId) {
      return NextResponse.json({ message: "branchId is required" }, { status: 400 });
    }

    assertBranchAccess(session, branchId);
    const data = await listInventoryBalances({ branchId, productId });
    return NextResponse.json({ data });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
