/**
 * Parte A (prompt-completo-pendientes-2026-10.md), §1.2 punto 4 — "antes de
 * cambiar, contar en producción en solo lectura y reportar": settings y
 * productos activos (para dimensionar el recorte sin paginar de
 * pricing-detector.ts), decisiones auto-resueltas, y reaperturas en 48h.
 *
 * Nota de orden: Parte A ya se implementó (paginación + markTruncated) en
 * una sesión previa a esta; esta consulta se corre ahora para el reporte
 * final, no antes del cambio como pedía el doc — los números siguen siendo
 * reales y útiles para dimensionar el estado actual, solo que no sirvieron
 * de "antes" para comparar con un "después".
 *
 * No escribe nada. Ejecutar con: npx tsx scripts/diagnose-brain-settings-autoclose.ts
 */
import { prisma } from "@/lib/prisma";

async function main() {
  const rows = await prisma.$queryRaw<Array<{ settings: bigint; productos: bigint; auto_resueltas: bigint; reaperturas_48h: bigint }>>`
    SELECT (SELECT COUNT(*) FROM "BranchProductSetting") AS settings,
           (SELECT COUNT(*) FROM "Product" WHERE "isActive") AS productos,
           (SELECT COUNT(*) FROM "BrainDecision" WHERE "resolutionSource"='AUTO') AS auto_resueltas,
           (SELECT COUNT(*) FROM "BrainDecisionActionLog" WHERE action='REOPENED' AND "createdAt" > now() - interval '2 days') AS reaperturas_48h
  `;
  const r = rows[0];
  console.log(JSON.stringify({
    settings: Number(r.settings),
    productosActivos: Number(r.productos),
    decisionesAutoResueltas: Number(r.auto_resueltas),
    reaperturas48h: Number(r.reaperturas_48h),
  }, null, 2));
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
