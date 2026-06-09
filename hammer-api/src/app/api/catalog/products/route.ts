import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { createProduct, listProducts, getTopSellingProducts, checkSkuAvailable, previewAutoSku } from "@/modules/catalog/service";
import { createProductSchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);

    // SKU availability check: GET /api/catalog/products?checkSku=ABC-123
    const checkSku = searchParams.get("checkSku");
    if (checkSku) {
      const excludeId = searchParams.get("excludeProductId") ?? undefined;
      return ok(await checkSkuAvailable(checkSku, excludeId));
    }

    // SKU preview: GET /api/catalog/products?previewSku=true&productName=...&categoryId=...
    if (searchParams.get("previewSku") === "true") {
      const productName = searchParams.get("productName") ?? "";
      const categoryId = searchParams.get("categoryId") ?? "";
      if (!productName || !categoryId) return fail("VALIDATION_ERROR", "productName y categoryId son obligatorios.", 400);
      return ok(await previewAutoSku({ productName, categoryId }));
    }

    const q = searchParams.get("q") ?? undefined;
    const isActiveParam = searchParams.get("isActive");
    const isActive = isActiveParam === null ? undefined : isActiveParam === "true";
    const topSelling = searchParams.get("topSelling") === "true";
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const branchId = searchParams.get("branchId") ?? undefined;
    const inStockOnly = searchParams.get("inStockOnly") === "true";

    if (topSelling) {
      const products = await getTopSellingProducts({ limit: limit ?? 5, isActive, branchId });
      return ok(products);
    }

    const products = await listProducts({ q, isActive, branchId, limit, inStockOnly });
    return ok(products);
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

    const parsed = createProductSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    const product = await createProduct({ ...parsed.data, actorUserId: session.userId });
    return created(product);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
