import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getTransfer } from "@/modules/transfers/service";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id } = await params;
    const transfer = await getTransfer(id);
    return ok(transfer);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
