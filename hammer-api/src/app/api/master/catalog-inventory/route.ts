import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { requireCsrf } from "@/modules/security/csrf";
import { catalogInventoryQuerySchema, updateBranchProductSettingSchema } from "@/modules/catalog-inventory/validators";
import { getCatalogInventoryCenter, upsertBranchProductSetting } from "@/modules/catalog-inventory/service";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(request.url);
    const parsed = catalogInventoryQuerySchema.safeParse({
      q: searchParams.get("q") ?? undefined,
      branchId: searchParams.get("branchId") ?? undefined,
      categoryId: searchParams.get("categoryId") ?? undefined,
      filter: searchParams.get("filter") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) return fail("VALIDATION_ERROR", "Filtros invalidos.", 400);

    return ok(await getCatalogInventoryCenter(parsed.data));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const parsed = updateBranchProductSettingSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400);

    return ok(await upsertBranchProductSetting(parsed.data, session.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
