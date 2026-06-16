import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCommandCenterSnapshot } from "@/modules/dashboard/command-center";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/master/command-center — Centro de Comando snapshot.
 *
 * Consolidated, real-time view for MASTER users: connected users, cash-closure
 * state (pending / completed today / history), physical cash-box status per
 * branch and current operational-day metrics.
 */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    const snapshot = await getCommandCenterSnapshot();
    return ok(snapshot);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
