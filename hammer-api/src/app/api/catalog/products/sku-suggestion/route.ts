import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { suggestProductSku } from "@/modules/catalog/service";
import { toHttpErrorResponse } from "@/lib/http";
import { fail, ok } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const productName = searchParams.get("name") ?? searchParams.get("productName") ?? "";
    const categoryId = searchParams.get("categoryId") ?? "";
    const productId = searchParams.get("productId") ?? undefined;

    if (!productName.trim() || !categoryId) {
      return fail("VALIDATION_ERROR", "name y categoryId son obligatorios.", 400);
    }

    return ok(await suggestProductSku({ productName: productName.trim(), categoryId, productId }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
