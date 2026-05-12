import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { updateExpenseSchema } from "@/modules/pricing/validators";
import { requireCsrf } from "@/modules/security/csrf";
import {
  updateOperatingExpense,
  deleteOperatingExpense,
} from "@/modules/pricing/service";

type Params = { params: Promise<{ id: string }> };

/**
 * PUT /api/expenses/[id]
 */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const { id } = await params;
    const body = await req.json();
    const parsed = updateExpenseSchema.parse(body);
    const updated = await updateOperatingExpense(id, parsed, session.userId);

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ message: "Datos inv\u00e1lidos", errors: (error as any).issues }, { status: 400 });
    }
    return toHttpErrorResponse(error);
  }
}

/**
 * DELETE /api/expenses/[id]
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const { id } = await params;
    await deleteOperatingExpense(id, session.userId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
