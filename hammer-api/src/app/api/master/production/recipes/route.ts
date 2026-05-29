import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertProductionPermission } from "@/modules/auth/production-guard";
import { getRecipes, createRecipe } from "@/modules/production/service";
import { createRecipeSchema } from "@/modules/production/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, validationFail } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await assertProductionPermission(session, "production.recipes.view");

    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? undefined;
    const isActive = url.searchParams.get("isActive");

    const recipes = await getRecipes({
      q,
      isActive: isActive === "true" ? true : isActive === "false" ? false : undefined,
    });

    return ok(recipes);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    await assertProductionPermission(session, "production.recipes.create");

    const parsed = createRecipeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return validationFail(parsed.error.issues);
    }

    const recipe = await createRecipe({ ...parsed.data, actorUserId: session.userId });
    return created(recipe);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
