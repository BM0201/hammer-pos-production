import assert from "node:assert/strict";
import test from "node:test";
import { dateWhere } from "@/modules/reports/service";
import { getOperationalWindowForManaguaDate } from "@/modules/sales/realtime-sales-summary";

/**
 * Auditoría 2026-07-22, hallazgo C7: reports/validators.ts usaba z.coerce.date()
 * sobre un "YYYY-MM-DD" de <input type="date">, lo que ancla el filtro a
 * medianoche UTC en vez de medianoche Managua (UTC-6). Un pago cobrado a las
 * 22:00 Managua del día 21 quedaba fuera del reporte "día 21" (en UTC ya son
 * las 04:00 del día 22), y uno cobrado a las 01:00 Managua del día 22 se
 * filtraba erróneamente como si fuera del día 21.
 *
 * El fix: reports/http.ts convierte dateFrom/dateTo (strings) a un rango
 * [inicio del día Managua, inicio del día SIGUIENTE en Managua) usando
 * getOperationalWindowForManaguaDate — el mismo helper ya probado que usa
 * getMasterDashboardSummary. dateWhere() usa "lt" (no "lte") en el límite
 * superior porque ahora representa un límite exclusivo.
 */
test("C7: un pago a las 22:00 Managua del dia 21 cae dentro del filtro dateFrom=dateTo=21", () => {
  const dateFrom = getOperationalWindowForManaguaDate("2026-07-21").start;
  const dateTo = getOperationalWindowForManaguaDate("2026-07-21").end;
  const where = dateWhere({ dateFrom, dateTo }, "paidAt");

  // 22:00 Managua (UTC-6) del 21 = 04:00 UTC del 22.
  const paidAt = new Date("2026-07-22T04:00:00.000Z");

  const gte = (where.paidAt as { gte: Date }).gte;
  const lt = (where.paidAt as { lt: Date }).lt;
  assert.ok(paidAt.getTime() >= gte.getTime(), "el pago de las 22:00 Managua debe estar dentro del rango (gte)");
  assert.ok(paidAt.getTime() < lt.getTime(), "el pago de las 22:00 Managua debe estar dentro del rango (lt)");
});

test("C7: un pago a la 01:00 Managua del dia 22 NO cae en el filtro del dia 21 (antes se colaba)", () => {
  const dateTo = getOperationalWindowForManaguaDate("2026-07-21").end;

  // 01:00 Managua del 22 = 07:00 UTC del 22 — ya es el día de negocio 22, no 21.
  const paidAt = new Date("2026-07-22T07:00:00.000Z");

  assert.ok(paidAt.getTime() >= dateTo.getTime(), "debe quedar excluido del día 21 por el límite exclusivo");
});

test("C7: con el bug anterior (medianoche UTC), ese mismo pago de las 22:00 Managua quedaba fuera", () => {
  // Reproduce z.coerce.date()("2026-07-21") = medianoche UTC del 21.
  const buggyDateTo = new Date("2026-07-21T00:00:00.000Z");
  const paidAt = new Date("2026-07-22T04:00:00.000Z"); // 22:00 Managua del 21

  assert.ok(paidAt.getTime() > buggyDateTo.getTime(), "con el bug, el pago de las 22:00 Managua ya quedaba fuera del filtro 'dateTo=21' (lte medianoche UTC)");
});
