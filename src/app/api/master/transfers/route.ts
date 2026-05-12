import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { listTransfers, createTransfer } from "@/modules/transfers/service";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const status = url.searchParams.get("status") as any;

    const transfers = await listTransfers(status ? { status } : undefined);
    return NextResponse.json({ data: transfers });
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

    if (!body.fromBranchId || !body.toBranchId) {
      return NextResponse.json({ message: "fromBranchId y toBranchId son requeridos" }, { status: 400 });
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ message: "Debe agregar al menos una línea" }, { status: 400 });
    }

    const transfer = await createTransfer({
      userId: session.userId,
      fromBranchId: body.fromBranchId,
      toBranchId: body.toBranchId,
      notes: body.notes,
      lines: body.lines,
    });

    return NextResponse.json({ data: transfer }, { status: 201 });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
