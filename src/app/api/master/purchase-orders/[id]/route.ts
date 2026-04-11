import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getPurchaseOrder } from "@/modules/purchase-orders/service";
import { toHttpErrorResponse } from "@/lib/http";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id } = await params;
    const order = await getPurchaseOrder(id);
    return NextResponse.json({ data: order });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
