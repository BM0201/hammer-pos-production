import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getBranchExposureStatus } from "@/modules/treasury/service";

/**
 * Exposición acumulada por sucursal (§1.3) — informa, nunca bloquea.
 *
 * prompt-tesoreria-gasto-retenido-y-techo.md T-3: sin maxAmount/maxBusinessDays
 * en el query, se carga la BranchDepositPolicy persistida de la sucursal
 * (thresholdAmount/maxDaysHolding) en vez de quedar siempre en "sin
 * alerta". El query sigue existiendo, pero ahora es SOLO un override
 * explícito para simular con otro criterio — manda sobre la política
 * guardada cuando viene. Sin política configurada sigue sin haber alerta;
 * eso es correcto y no cambia — lo que se corrige es que antes tampoco la
 * había cuando SÍ hay política.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es obligatorio.", 400);

    const maxAmountRaw = url.searchParams.get("maxAmount");
    const maxDaysRaw = url.searchParams.get("maxBusinessDays");
    let threshold = maxAmountRaw && maxDaysRaw
      ? { maxAmount: Number(maxAmountRaw), maxBusinessDays: Number(maxDaysRaw) }
      : null;

    if (!threshold) {
      const policy = await prisma.branchDepositPolicy.findUnique({ where: { branchId }, select: { thresholdAmount: true, maxDaysHolding: true } });
      if (policy) {
        threshold = { maxAmount: Number(policy.thresholdAmount), maxBusinessDays: policy.maxDaysHolding };
      }
    }

    return ok(await getBranchExposureStatus(branchId, threshold));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
