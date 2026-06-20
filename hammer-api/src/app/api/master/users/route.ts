import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { createUser, listBranchesForMembershipManagement, listUsersWithMemberships } from "@/modules/users/service";
import { createUserSchema } from "@/modules/users/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail, forbidden } from "@/lib/api/response";
import { assertCanSetGlobalRole } from "@/modules/auth/role-hierarchy";

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

    // Verificar jerarquía de roles antes de crear
    try {
      assertCanSetGlobalRole(session!, parsed.data.globalRole);
    } catch {
      return forbidden("No tienes permisos para asignar ese rol global.");
    }

    const { id, tempPassword } = await createUser(parsed.data, session!.userId);
    // tempPassword se retorna UNA SOLA VEZ — el frontend debe mostrarlo inmediatamente
    return created({ id, tempPassword });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
