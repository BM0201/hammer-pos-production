import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { approveTransfer } from "@/modules/transfers/service";
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
    const result = await approveTransfer(id, session.userId);
    return NextResponse.json({ data: result, message: "Envío aprobado e inventario actualizado" });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
