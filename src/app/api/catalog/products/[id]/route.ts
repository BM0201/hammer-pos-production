import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { updateProduct } from "@/modules/catalog/service";
import { updateProductSchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id } = await context.params;
    const parsed = updateProductSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
    }

    const product = await updateProduct(id, { ...parsed.data, actorUserId: session.userId });
    return NextResponse.json({ data: product });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
