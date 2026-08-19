import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertProductionPermission } from "@/modules/auth/production-guard";
import { getRecipeById, updateRecipe } from "@/modules/production/service";
import { updateRecipeSchema } from "@/modules/production/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, validationFail } from "@/lib/api/response";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await assertProductionPermission(session, "production.recipes.view");

    const { id } = await context.params;
    const recipe = await getRecipeById(id);
    return ok(recipe);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    await assertProductionPermission(session, "production.recipes.edit");

    const { id } = await context.params;
    const parsed = updateRecipeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return validationFail(parsed.error.issues);
    }

    const recipe = await updateRecipe(id, { ...parsed.data, actorUserId: session.userId });
    return ok(recipe);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
