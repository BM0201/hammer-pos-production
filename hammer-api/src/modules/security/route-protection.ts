/**
 * Route protection helpers.
 *
 * Combines authentication + CSRF validation into a single call
 * so that every mutating API route can be hardened with one line:
 *
 *   const session = await requireAuthAndCsrf(request);
 *
 * EXCEPTIONS that must NOT use this helper:
 *  - /api/auth/login         → no session exists yet
 *  - /api/auth/csrf          → GET-only, generates tokens
 *  - /api/auth/session       → GET-only, reads session
 */

import type { SessionPayload } from "@/types/auth";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";

/**
 * Enforce authentication + CSRF in a single call.
 *
 * 1. Reads the session from the cookie.
 * 2. Asserts the user is authenticated (throws "UNAUTHENTICATED" otherwise).
 * 3. Validates the x-csrf-token header against the DB (throws CsrfError otherwise).
 *
 * @returns The authenticated session payload.
 */
export async function requireAuthAndCsrf(request: Request): Promise<SessionPayload> {
  const session = await getCurrentSession();
  assertAuthenticated(session);
  await requireCsrf(request, session);
  return session;
}
