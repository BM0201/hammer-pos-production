import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, created, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { createBankAccountSchema } from "@/modules/treasury/validators";
import { createBankAccount, listBankAccounts } from "@/modules/treasury/service";

/** Son varias, editable solo por Master (correccion-destino-y-pantalla-cobro.md §5). */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId");
    const forPayments = url.searchParams.get("forPayments") === "true";
    return ok(await listBankAccounts(branchId, forPayments));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const parsed = createBankAccountSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const account = await createBankAccount({ ...parsed.data, actorUserId: session.userId });
    return created(account);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
