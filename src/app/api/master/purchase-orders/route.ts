import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { listPurchaseOrders, createPurchaseOrder } from "@/modules/purchase-orders/service";
import { toHttpErrorResponse } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const status = url.searchParams.get("status") as any;

    const orders = await listPurchaseOrders(status ? { status } : undefined);
    return NextResponse.json({ data: orders });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const body = await request.json();

    if (!body.branchId) {
      return NextResponse.json({ message: "branchId es requerido" }, { status: 400 });
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ message: "Debe agregar al menos una línea" }, { status: 400 });
    }

    const order = await createPurchaseOrder({
      userId: session.userId,
      branchId: body.branchId,
      supplier: body.supplier,
      notes: body.notes,
      lines: body.lines,
    });

    return NextResponse.json({ data: order }, { status: 201 });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
