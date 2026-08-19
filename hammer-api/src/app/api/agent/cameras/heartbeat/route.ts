import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { heartbeatSchema } from "@/modules/cameras/validators";
import { recordHeartbeat, verifyAgentToken } from "@/modules/cameras/service";

/**
 * Máquina a máquina — sin sesión de usuario ni CSRF (no hay navegador del
 * lado del agente). Autenticación por bearer token propio de la sucursal,
 * provisionado una vez desde el panel Master (adenda §1/§2).
 */
export async function POST(request: Request) {
  try {
    const parsed = heartbeatSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return fail("UNAUTHENTICATED", "Falta el token del agente.", 401);

    const validToken = await verifyAgentToken(parsed.data.branchId, token);
    if (!validToken) return fail("FORBIDDEN", "Token de agente invalido para esta sucursal.", 403);

    // Contrato versionado (adenda §2.3): el servidor tolera versiones viejas
    // -- no rechaza por protocolVersion distinto, solo lo registra.
    const result = await recordHeartbeat({
      branchId: parsed.data.branchId,
      agentVersion: parsed.data.agentVersion,
      nvrReachable: parsed.data.nvrReachable,
      cameraStates: parsed.data.cameras.map((c) => ({ cameraId: c.cameraId, state: c.state })),
    });

    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
