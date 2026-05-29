import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { listPurchaseOrders, createPurchaseOrder } from "@/modules/purchase-orders/service";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const status = url.searchParams.get("status") as any;

    const orders = await listPurchaseOrders(status ? { status } : undefined);
    return ok(orders);
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

    const body = await request.json();

    if (!body.branchId) {
      return fail("VALIDATION_ERROR", "branchId es requerido", 400);
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return fail("VALIDATION_ERROR", "Debe agregar al menos una línea", 400);
    }

    const order = await createPurchaseOrder({
      userId: session.userId,
      branchId: body.branchId,
      supplier: body.supplier,
      notes: body.notes,
      purchaseTaxTreatment: body.purchaseTaxTreatment,
      freightAmount: body.freightAmount,
      otherChargesAmount: body.otherChargesAmount,
      globalDiscountAmount: body.globalDiscountAmount,
      lines: body.lines,
    });

    return created(order);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
