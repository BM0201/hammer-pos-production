import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { getCameraHealthGlobalSummary } from "@/modules/cameras/service";

/** Suma global (todas las sucursales) para el badge del sidebar — snapshot, nunca estado en vivo. */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    return ok(await getCameraHealthGlobalSummary());
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
