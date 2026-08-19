import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, validationFail, fail } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { PRODUCTION_PERMISSIONS } from "@/modules/auth/production-guard";

const grantPermissionSchema = z.object({
  userId: z.string().cuid(),
  permission: z.string().refine(
    (p) => (PRODUCTION_PERMISSIONS as readonly string[]).includes(p),
    { message: "Permiso de producción inválido" },
  ),
  granted: z.boolean().default(true),
});

/**
 * GET /api/master/admin/user-permissions?userId=xxx
 * List all production permissions for a user (overrides only).
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");

    const where = userId ? { userId } : {};
    const permissions = await prisma.userPermission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        grantedByUser: { select: { id: true, fullName: true } },
      },
    });

    return ok(permissions);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

/**
 * POST /api/master/admin/user-permissions
 * Grant or revoke a specific production permission for a user.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const parsed = grantPermissionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return validationFail(parsed.error.issues);
    }

    const { userId, permission, granted } = parsed.data;

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { globalRole: true },
    });

    if (!targetUser || targetUser.globalRole !== "MASTER") {
      return fail("FORBIDDEN_PRODUCTION_PERMISSION", "Los permisos de produccion solo pueden asignarse a usuarios MASTER.", 403);
    }

    const record = await prisma.userPermission.upsert({
      where: { userId_permission: { userId, permission } },
      update: { granted, grantedBy: session.userId },
      create: { userId, permission, granted, grantedBy: session.userId },
    });

    return created(record);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
