import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { prisma } from "@/lib/prisma";
import { toHttpErrorResponse } from "@/lib/http";
import { okCached } from "@/lib/api/response";
import { isPrivilegedGlobal } from "@/modules/rbac/guards";

/**
 * GET /api/branches — lightweight list of all branches.
 * Used by dropdowns (e.g. timber trips destination selector).
 */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const branches = await prisma.branch.findMany({
      where: isPrivilegedGlobal(session)
        ? { isActive: true }
        : {
            isActive: true,
            userBranchRoles: {
              some: { userId: session.userId, isActive: true },
            },
          },
      select: { id: true, code: true, name: true, isActive: true, isDefaultSupplier: true },
      orderBy: { name: "asc" },
    });

    // Near-static reference data fetched by ~18 screens; 5 min private browser
    // cache (never shared/CDN) cuts repeat invocations without cross-user risk.
    return okCached(branches, 300);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
