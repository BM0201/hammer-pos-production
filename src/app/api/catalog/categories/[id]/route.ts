import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { updateCategory } from "@/modules/catalog/service";
import { updateCategorySchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id } = await context.params;
    const parsed = updateCategorySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
    }

    const category = await updateCategory(id, { ...parsed.data, actorUserId: session.userId });
    return NextResponse.json({ data: category });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
