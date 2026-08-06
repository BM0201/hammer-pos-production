import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { created, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { createSupplier, listSuppliers } from "@/modules/suppliers/service";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    const url = new URL(request.url);
    return ok(await listSuppliers({
      q: url.searchParams.get("q") ?? undefined,
      includeInactive: url.searchParams.get("includeInactive") === "true",
    }));
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
    const supplier = await createSupplier(await request.json().catch(() => ({})), session.userId);
    return created(supplier);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
