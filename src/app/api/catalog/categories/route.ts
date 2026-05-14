import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { createCategory, listCategories } from "@/modules/catalog/service";
import { createCategorySchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const categories = await listCategories();
    return NextResponse.json({ data: categories });
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

    const parsed = createCategorySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
    }

    const category = await createCategory({ ...parsed.data, actorUserId: session.userId });
    return NextResponse.json({ data: category }, { status: 201 });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
