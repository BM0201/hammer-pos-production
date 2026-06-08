import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { createCategory, listCategories } from "@/modules/catalog/service";
import { createCategorySchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const categories = await listCategories();
    return ok(categories);
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
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    const category = await createCategory({ ...parsed.data, actorUserId: session.userId });
    return created(category);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
