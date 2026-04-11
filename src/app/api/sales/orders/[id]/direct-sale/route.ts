export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { submitDirectSale } from "@/modules/sales/service";
import { toHttpErrorResponse } from "@/lib/http";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    const body = await request.json();

    const result = await submitDirectSale({
      saleOrderId: params.id,
      actorUserId: session.userId,
      method: body?.method ?? "CASH",
      requiresTransport: body?.requiresTransport,
      transportAmount: body?.transportAmount,
      referenceNumber: body?.referenceNumber ?? null,
    });

    return NextResponse.json({ order: result });
  } catch (error: any) {
    return toHttpErrorResponse(error);
  }
}
