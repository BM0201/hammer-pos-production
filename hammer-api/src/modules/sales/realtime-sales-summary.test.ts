import assert from "node:assert/strict";
import test from "node:test";
import { businessDateToYmdUTC, businessDateYmd, getOperationalWindowForManaguaDate } from "@/modules/sales/realtime-sales-summary";

test("realtime sales window uses Managua day at UTC-06", () => {
  const window = getOperationalWindowForManaguaDate("2026-06-10");

  assert.equal(window.businessDate, "2026-06-10");
  assert.equal(window.timezone, "America/Managua");
  assert.equal(window.start.toISOString(), "2026-06-10T06:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-06-11T06:00:00.000Z");
});

test("realtime sales window derives Managua date near UTC midnight", () => {
  const window = getOperationalWindowForManaguaDate(new Date("2026-06-11T03:30:00.000Z"));

  assert.equal(window.businessDate, "2026-06-10");
  assert.equal(window.start.toISOString(), "2026-06-10T06:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-06-11T06:00:00.000Z");
});

// ── Regresión BUG: resumen del día operativo corrido un día ──────────────────
// OperationalDay.businessDate se guarda a las 00:00 UTC del día local Managua
// (businessDateFromNow). Su YMD debe leerse por componentes UTC.

test("businessDateToYmdUTC lee un businessDate (00:00 UTC) sin corrimiento", () => {
  assert.equal(businessDateToYmdUTC(new Date(Date.UTC(2026, 6, 8))), "2026-07-08");
});

test("BUG documentado: businessDateYmd aplicado a un businessDate devuelve el día ANTERIOR", () => {
  // businessDateYmd formatea en America/Managua (UTC-6) y es para INSTANTES
  // reales: 2026-07-08T00:00Z son las 6pm Managua del 07. Aplicada al
  // businessDate del OperationalDay corría toda la ventana de ventas un día
  // hacia atrás — por eso NO debe usarse con businessDate.
  assert.equal(businessDateYmd(new Date(Date.UTC(2026, 6, 8))), "2026-07-07");
});
