import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { createUser, listBranchesForMembershipManagement, listUsersWithMemberships } from "@/modules/users/service";
import { createUserSchema } from "@/modules/users/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const [users, branches] = await Promise.all([
      listUsersWithMemberships(),
      listBranchesForMembershipManagement(),
    ]);

    return ok({ users, branches });
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

    const parsed = createUserSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Datos inválidos.", 400);
    }

    const newUser = await createUser(parsed.data);
    return created(newUser);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
