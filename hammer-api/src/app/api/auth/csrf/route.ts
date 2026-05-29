import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { createCsrfToken } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

// GET: Generate a new CSRF token
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const token = await createCsrfToken(session.userId);
    return ok({ csrfToken: token });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return fail("UNAUTHENTICATED", "Unauthorized", 401);
    }
    return fail("INTERNAL_ERROR", "Error generating CSRF token", 500);
  }
}
