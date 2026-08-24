import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getBranchCashPosition, countConsecutivePostponements } from "@/modules/treasury/cash-monitor";

/**
 * Master ve todas las sucursales colapsadas — el indicador de cada una,
 * para priorizar por estado en el propio panel (prompt-indicador-efectivo-
 * inteligente.md §6). consecutivePostponements viaja acá porque es la
 * única forma en que Master se entera de que un cajero está posponiendo
 * el depósito — si nunca lo ve, posponer es un botón que solo sirve para
 * que la plata se quede quieta sin que nadie se entere.
 */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const branches = await prisma.branch.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } });
    const positions = await Promise.all(branches.map(async (branch) => ({
      branch,
      position: await getBranchCashPosition(branch.id),
      consecutivePostponements: await countConsecutivePostponements(branch.id),
    })));
    return ok(positions);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
