import { getCurrentSession } from "@/modules/auth/service";
import { toHttpErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api/response";
import { getEnrichedSessionData } from "@/modules/auth/effective-permissions";
import { markUserOnline } from "@/modules/auth/presence-service";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return fail("UNAUTHENTICATED", "No autenticado", 401);
    }

    // Fetch mustChangePassword from DB so the frontend can enforce the redirect
    let mustChangePassword = false;
    try {
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { mustChangePassword: true },
      });
      mustChangePassword = user?.mustChangePassword ?? false;
    } catch {
      // If DB is unavailable degrade gracefully
    }

    let enriched: Awaited<ReturnType<typeof getEnrichedSessionData>> = null;
    try {
      enriched = await getEnrichedSessionData(session.userId);
      await markUserOnline({
        session,
        branchId: session.primaryBranchId,
        currentPath: new URL(request.url).pathname,
        currentModule: "session",
      });
    } catch (presenceError) {
      console.error("[auth/session] No fue posible enriquecer sesion/presencia", presenceError);
    }

    return ok({
      authenticated: true,
      user: {
        userId: session.userId,
        username: session.username,
        globalRoles: session.globalRoles,
        branchMemberships: session.branchMemberships,
        primaryBranchId: session.primaryBranchId,
        roleCode: session.roleCode,
        branchIds: session.branchIds,
        sessionVersion: enriched?.sessionVersion ?? session.sessionVersion ?? 0,
        mustChangePassword,
        effectiveCapabilities: enriched?.globalCapabilities ?? [],
        modules: enriched?.modules,
        activeBranchId: enriched?.activeBranchId ?? session.primaryBranchId,
        branches: enriched?.branches ?? [],
      },
      activeBranchId: enriched?.activeBranchId ?? session.primaryBranchId,
      branches: enriched?.branches ?? [],
      globalCapabilities: enriched?.globalCapabilities ?? [],
      modules: enriched?.modules,
      sessionVersion: enriched?.sessionVersion ?? session.sessionVersion ?? 0,
    });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
