import { NextResponse } from "next/server";
import { checkDatabaseConnectivity } from "@/lib/db";
import { findTreasuryRowsFromDemoUsers } from "@/modules/treasury/test-data-guard";

/**
 * Readiness probe — valida que las dependencias críticas (PostgreSQL) estén
 * disponibles y respondiendo. Usa Node.js runtime (no Edge) para poder
 * conectar con Prisma.
 *
 * Diferencia con /health (liveness):
 *   /health  → siempre 200, sin tocar DB ni dependencias externas.
 *   /ready   → 200 solo si la DB responde Y (en producción) no hay datos de
 *              prueba de tesorería visibles; 503 si no.
 *
 * Kubernetes / Docker:
 *   livenessProbe  → /health
 *   readinessProbe → /ready
 *
 * prompt-correccion-ubicacion-formula-datos-prueba.md C4/§2.4: el chequeo de
 * datos de prueba solo corre con NODE_ENV=production — en cualquier otro
 * ambiente esos datos son esperables y no deben hacer fallar el readiness.
 */
export const runtime = "nodejs";

export async function GET() {
  const dbOk = await checkDatabaseConnectivity(5_000);

  if (!dbOk) {
    return NextResponse.json(
      { status: "unavailable", database: "disconnected", timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }

  if (process.env.NODE_ENV === "production") {
    try {
      const testData = await findTreasuryRowsFromDemoUsers();
      if (testData.found) {
        return NextResponse.json(
          {
            status: "unavailable",
            database: "connected",
            reason: "TREASURY_TEST_DATA_DETECTED",
            detail: testData.detail,
            timestamp: new Date().toISOString(),
          },
          { status: 503 },
        );
      }
    } catch {
      // Sin bloquear el arranque real por un chequeo secundario que falló —
      // la conectividad de DB (lo crítico) ya se confirmó arriba.
    }
  }

  return NextResponse.json(
    { status: "ready", database: "connected", timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
