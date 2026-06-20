import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { softDeleteUser, updateUser, getUserById } from "@/modules/users/service";
import { updateUserSchema } from "@/modules/users/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail, forbidden } from "@/lib/api/response";
import { assertCanSetGlobalRole, assertCanManageUser } from "@/modules/auth/role-hierarchy";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const parsed = updateUserSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Datos inválidos.", 400);
    }

    // Verificar que el actor puede gestionar al usuario objetivo
    const target = await getUserById(id);
    if (!target) return fail("NOT_FOUND", "Usuario no encontrado.", 404);

    try {
      assertCanManageUser(session!, target.globalRole);
      if (parsed.data.globalRole !== undefined) {
        assertCanSetGlobalRole(session!, parsed.data.globalRole);
      }
    } catch {
      return forbidden("No tienes permisos para modificar este usuario o asignar ese rol.");
    }

    const result = await updateUser(id, session!.userId, parsed.data);
    // tempPassword presente solo cuando el admin resetea la contraseña
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const target = await getUserById(id);
    if (!target) return fail("NOT_FOUND", "Usuario no encontrado.", 404);

    try {
      assertCanManageUser(session!, target.globalRole);
    } catch {
      return forbidden("No tienes permisos para eliminar este usuario.");
    }

    const result = await softDeleteUser(id, session!.userId);
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
