import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { cancelPurchaseOrder } from "@/modules/purchase-orders/service";
import { toHttpErrorResponse } from "@/lib/http";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id } = await params;
    const result = await cancelPurchaseOrder(id, session.userId);
    return NextResponse.json({ data: result, message: "Pedido cancelado" });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
