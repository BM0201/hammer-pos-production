/**
 * Script de recálculo de días operativos.
 *
 * CONTEXTO
 * --------
 * Los totales del día operativo (salesTotal, paidOrdersTotal, pendingPaymentTotal,
 * paymentsByMethod, etc.) se PERSISTEN en columnas de la tabla `OperationalDay`.
 * Antes del fix, `calculateOperationalSummaryTx()` no excluía ventas anuladas
 * (`voidedAt`) ni de prueba (`isTest`), por lo que los días ya guardados quedaron
 * con cifras infladas. Corregir el código solo arregla los días que se vuelven a
 * refrescar (el día OPEN se autocorrige al abrir el dashboard); los días CLOSED
 * quedan congelados con valores erróneos.
 *
 * Este script vuelve a correr `refreshOperationalDaySummaryTx()` (que ya usa el
 * helper de "venta válida") sobre los días indicados, sobrescribiendo las
 * columnas persistidas con los valores corregidos.
 *
 * USO
 * ---
 *   # Todos los días OPEN + los CLOSED de los últimos 30 días (por defecto):
 *   DATABASE_URL="..." DIRECT_URL="..." npx tsx scripts/recalc-operational-days.ts
 *
 *   # Una cantidad distinta de días hacia atrás para los CLOSED:
 *   ... npx tsx scripts/recalc-operational-days.ts --days=90
 *
 *   # Sólo una sucursal:
 *   ... npx tsx scripts/recalc-operational-days.ts --branch=<branchId>
 *
 *   # Simulación (no escribe; sólo muestra qué días se recalcularían):
 *   ... npx tsx scripts/recalc-operational-days.ts --dry-run
 *
 * NOTA: los días CLOSED se recalculan también; si no deseas tocar cierres ya
 * firmados, usa --open-only.
 */
import { OperationalDayStatus, PrismaClient } from "@prisma/client";
import { refreshOperationalDaySummaryTx } from "../src/modules/operations/service";

function parseArgs(argv: string[]) {
  const args = { days: 30, branch: undefined as string | undefined, dryRun: false, openOnly: false };
  for (const raw of argv.slice(2)) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "--open-only") args.openOnly = true;
    else if (raw.startsWith("--days=")) args.days = Math.max(0, Number(raw.split("=")[1]) || 0);
    else if (raw.startsWith("--branch=")) args.branch = raw.split("=")[1] || undefined;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const prisma = new PrismaClient();

  const since = new Date();
  since.setDate(since.getDate() - args.days);

  const statuses: OperationalDayStatus[] = args.openOnly
    ? [OperationalDayStatus.OPEN]
    : [OperationalDayStatus.OPEN, OperationalDayStatus.CLOSING, OperationalDayStatus.CLOSED];

  const days = await prisma.operationalDay.findMany({
    where: {
      ...(args.branch ? { branchId: args.branch } : {}),
      OR: [
        { status: OperationalDayStatus.OPEN },
        { status: { in: statuses }, businessDate: { gte: since } },
      ],
    },
    select: { id: true, branchId: true, businessDate: true, status: true, salesTotal: true },
    orderBy: [{ businessDate: "desc" }],
  });

  console.log(`Días a recalcular: ${days.length} (días hacia atrás: ${args.days}, dry-run: ${args.dryRun})`);

  let updated = 0;
  for (const day of days) {
    const before = Number(day.salesTotal ?? 0);
    if (args.dryRun) {
      console.log(`  [DRY] ${day.businessDate.toISOString().slice(0, 10)} · ${day.status} · ${day.id} (salesTotal actual: ${before})`);
      continue;
    }
    await prisma.$transaction((tx) => refreshOperationalDaySummaryTx(tx, day.id));
    const after = await prisma.operationalDay.findUnique({ where: { id: day.id }, select: { salesTotal: true } });
    const afterVal = Number(after?.salesTotal ?? 0);
    const delta = afterVal - before;
    console.log(`  [OK]  ${day.businessDate.toISOString().slice(0, 10)} · ${day.status} · ${day.id} · salesTotal ${before} → ${afterVal}${delta !== 0 ? `  (Δ ${delta})` : ""}`);
    updated += 1;
  }

  console.log(`\nListo. Días actualizados: ${updated}.`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Error en el recálculo:", error);
  process.exit(1);
});
