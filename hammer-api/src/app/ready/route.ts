import { NextResponse } from "next/server";
import { checkDatabaseConnectivity } from "@/lib/db";

/**
 * Readiness probe — valida que las dependencias críticas (PostgreSQL) estén
 * disponibles y respondiendo. Usa Node.js runtime (no Edge) para poder
 * conectar con Prisma.
 *
 * Diferencia con /health (liveness):
 *   /health  → siempre 200, sin tocar DB ni dependencias externas.
 *   /ready   → 200 solo si la DB responde; 503 si no.
 *
 * Kubernetes / Docker:
 *   livenessProbe  → /health
 *   readinessProbe → /ready
 */
export const runtime = "nodejs";

export async function GET() {
  const dbOk = await checkDatabaseConnectivity(5_000);

  if (dbOk) {
    return NextResponse.json(
      {
        status: "ready",
        database: "connected",
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      status: "unavailable",
      database: "disconnected",
      timestamp: new Date().toISOString(),
    },
    { status: 503 },
  );
}
