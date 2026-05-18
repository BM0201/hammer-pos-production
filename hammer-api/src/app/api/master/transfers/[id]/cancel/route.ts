import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { cancelTransfer } from "@/modules/transfers/service";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await params;
    const result = await cancelTransfer(id, session.userId);
    return NextResponse.json({ data: result, message: "Envío cancelado" });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
