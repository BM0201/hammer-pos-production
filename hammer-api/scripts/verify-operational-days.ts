/**
 * Re-verificación (DRY-RUN, siempre) de días operativos CERRADOS.
 *
 * Recorre los OperationalDay CLOSED de los últimos N días (default 30) y
 * recalcula, con la lógica CORREGIDA:
 *  - salesTotal con la ventana correcta del businessDate (businessDateToYmdUTC;
 *    el bug la corría un día hacia atrás),
 *  - expectedCash por sesión SIN la doble resta del vuelto
 *    (calculateExpectedCashForSessionTx ya corregido),
 *  - diferencia de caja = Σ (contado − esperado recalculado) de las sesiones
 *    revisadas (requiresReview: false, mismo conjunto que counted).
 *
 * Imprime una tabla por día comparando lo GUARDADO al cierre vs lo RECALCULADO
 * y al final el total de días con discrepancia. NO modifica ningún dato:
 * closeSummaryJson y las columnas del día son snapshots inmutables del cierre
 * histórico y se respetan (ver README-verify-operational-days.md).
 *
 * Uso: npx tsx scripts/verify-operational-days.ts [dias]
 *   ej. npx tsx scripts/verify-operational-days.ts 60
 */
import { OperationalDayStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildBranchRealtimeSalesSummary, businessDateToYmdUTC } from "@/modules/sales/realtime-sales-summary";
import { calculateExpectedCashForSessionTx } from "@/modules/cash-session/service";

const EPSILON = 0.01; // tolerancia de centavo por redondeos Decimal→number

const n = (v: unknown) => Number(v ?? 0);
const money = (v: number) => v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cmp = (stored: number, recalced: number) => `${money(stored)} → ${money(recalced)}${Math.abs(stored - recalced) > EPSILON ? " ⚠" : ""}`;

async function main() {
  const days = Math.max(1, Number(process.argv[2] ?? 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  // businessDate vive a las 00:00 UTC → comparar contra medianoche UTC.
  since.setUTCHours(0, 0, 0, 0);

  const closedDays = await prisma.operationalDay.findMany({
    where: { status: OperationalDayStatus.CLOSED, businessDate: { gte: since } },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      cashSessions: {
        select: { id: true, openingAmount: true, countedCashAmount: true, requiresReview: true },
      },
    },
    orderBy: [{ businessDate: "asc" }, { branchId: "asc" }],
  });

  console.log(`Re-verificación DRY-RUN de ${closedDays.length} día(s) CLOSED desde ${since.toISOString().slice(0, 10)} (últimos ${days} días).`);
  console.log("Nada se modifica: los snapshots del cierre son inmutables.\n");
  console.log("businessDate | suc | salesTotal guardado → recalc | expectedCash guardado → recalc | difCaja guardada → recalc | Δ");
  console.log("-".repeat(120));

  let discrepancies = 0;

  for (const day of closedDays) {
    // 1) Ventas con la ventana CORRECTA del businessDate (el bug usaba la del día anterior).
    const sales = await buildBranchRealtimeSalesSummary(prisma, day.branch, businessDateToYmdUTC(day.businessDate));

    // 2) Esperado por sesión con la fórmula corregida (sin doble resta del vuelto).
    //    Mismo conjunto que counted/difference: solo sesiones revisadas.
    let expectedRecalc = 0;
    let differenceRecalc = 0;
    for (const session of day.cashSessions) {
      if (session.requiresReview) continue;
      const snapshot = await calculateExpectedCashForSessionTx(prisma, session.id, session.openingAmount);
      expectedRecalc += snapshot.expectedCash;
      if (session.countedCashAmount != null) {
        differenceRecalc += n(session.countedCashAmount) - snapshot.expectedCash;
      }
    }

    const storedSales = n(day.salesTotal);
    const storedExpected = n(day.expectedCashTotal);
    const storedDifference = n(day.cashDifferenceTotal);

    const delta =
      Math.abs(storedSales - sales.paidSalesTotal) > EPSILON ||
      Math.abs(storedExpected - expectedRecalc) > EPSILON ||
      Math.abs(storedDifference - differenceRecalc) > EPSILON;
    if (delta) discrepancies++;

    console.log(
      [
        businessDateToYmdUTC(day.businessDate),
        (day.branch.code ?? "").padEnd(4),
        cmp(storedSales, sales.paidSalesTotal),
        cmp(storedExpected, expectedRecalc),
        cmp(storedDifference, differenceRecalc),
        delta ? "≠" : "ok",
      ].join(" | "),
    );
  }

  console.log("-".repeat(120));
  console.log(`Días con discrepancia: ${discrepancies} de ${closedDays.length}.`);
  console.log(
    "Recordatorio: este reporte EXPLICA descuadres históricos producidos por los bugs corregidos " +
      "(ventana corrida un día, doble resta del vuelto); no reescribe los cierres.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
