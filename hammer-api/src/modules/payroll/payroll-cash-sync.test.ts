/**
 * Run: npx tsx --test src/modules/payroll/payroll-cash-sync.test.ts
 *
 * Replica en puro TS (sin Prisma) la lógica de agrupamiento de
 * applyPendingPayrollCashOuts: agrupa PayrollDisbursement PAID con
 * cashMovementId=null por payrollRunId+period, sumando el monto por grupo.
 *
 * Bug reportado (2026-07-30): al aplicar una quincena a caja un día distinto
 * al programado (scheduledDate — el 15 o el fin de mes; ej. la quincena del
 * 15 quedó "pendiente de aplicar" por falta de caja abierta y recién se
 * aplica el 30, junto con la del mes), el gasto se veía en el historial del
 * día como un monto "sorpresa" sin explicación, indistinguible del gasto
 * normal de HOY. El monto y el día del CashMovement NO cambian (el efectivo
 * salió físicamente ese día, no se reescribe un cierre ya conciliado) — se
 * agrega la fecha real a la que corresponde en el `reason`, y un flag
 * `appliedLate` en la auditoría.
 */
import assert from "node:assert/strict";
import { describe, it, test } from "node:test";

type Disbursement = {
  id: string;
  payrollRunId: string;
  period: "FIRST_HALF" | "SECOND_HALF";
  amount: number;
  status: "PENDING" | "PAID";
  cashMovementId: string | null;
  scheduledDate: Date;
};

const PERIOD_LABEL: Record<string, string> = { FIRST_HALF: "1ra", SECOND_HALF: "2da" };

function formatScheduledDate(date: Date): string {
  return date.toLocaleDateString("es-NI", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function isSameUtcCalendarDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

function groupPendingCashOuts(disbursements: Disbursement[], now: Date) {
  const pending = disbursements.filter((d) => d.status === "PAID" && d.cashMovementId === null);
  if (pending.length === 0) return [];

  const groups = new Map<string, Disbursement[]>();
  for (const d of pending) {
    const key = `${d.payrollRunId}:${d.period}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  const result: Array<{ payrollRunId: string; period: string; total: number; employeeCount: number; reason: string; appliedLate: boolean }> = [];
  for (const [key, rows] of groups) {
    const [payrollRunId, period] = key.split(":");
    const total = rows.reduce((s, r) => s + r.amount, 0);
    if (total <= 0) continue;
    const scheduledDate = rows[0].scheduledDate;
    const appliedLate = !isSameUtcCalendarDay(scheduledDate, now);
    const employeeLabel = `${rows.length} empleado${rows.length === 1 ? "" : "s"}`;
    const reason = appliedLate
      ? `Nómina ${PERIOD_LABEL[period] ?? period} quincena — correspondiente al ${formatScheduledDate(scheduledDate)} (aplicada con retraso, ${employeeLabel})`
      : `Nómina ${PERIOD_LABEL[period] ?? period} quincena (${employeeLabel})`;
    result.push({ payrollRunId, period, total, employeeCount: rows.length, reason, appliedLate });
  }
  return result;
}

const JUL_15 = new Date("2026-07-15T00:00:00.000Z");
const JUL_30 = new Date("2026-07-30T00:00:00.000Z");

describe("groupPendingCashOuts (agrupamiento de payroll-cash-sync)", () => {
  it("agrupa varios disbursements PAID del mismo run+period en un único total", () => {
    const groups = groupPendingCashOuts([
      { id: "d1", payrollRunId: "run1", period: "FIRST_HALF", amount: 500, status: "PAID", cashMovementId: null, scheduledDate: JUL_15 },
      { id: "d2", payrollRunId: "run1", period: "FIRST_HALF", amount: 750, status: "PAID", cashMovementId: null, scheduledDate: JUL_15 },
    ], JUL_15);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].total, 1250);
    assert.equal(groups[0].employeeCount, 2);
    assert.equal(groups[0].reason, "Nómina 1ra quincena (2 empleados)");
  });

  it("separa grupos distintos por period dentro del mismo run", () => {
    const groups = groupPendingCashOuts([
      { id: "d1", payrollRunId: "run1", period: "FIRST_HALF", amount: 300, status: "PAID", cashMovementId: null, scheduledDate: JUL_15 },
      { id: "d2", payrollRunId: "run1", period: "SECOND_HALF", amount: 300, status: "PAID", cashMovementId: null, scheduledDate: JUL_30 },
    ], JUL_30);
    assert.equal(groups.length, 2);
    assert.ok(groups.some((g) => g.period === "FIRST_HALF" && g.total === 300));
    assert.ok(groups.some((g) => g.period === "SECOND_HALF" && g.total === 300));
  });

  it("ignora disbursements PENDING (no pagados) y los ya aplicados (cashMovementId != null)", () => {
    const groups = groupPendingCashOuts([
      { id: "d1", payrollRunId: "run1", period: "FIRST_HALF", amount: 500, status: "PENDING", cashMovementId: null, scheduledDate: JUL_15 },
      { id: "d2", payrollRunId: "run1", period: "FIRST_HALF", amount: 500, status: "PAID", cashMovementId: "cm1", scheduledDate: JUL_15 },
    ], JUL_15);
    assert.equal(groups.length, 0);
  });

  it("singular correcto en el texto cuando hay un solo empleado", () => {
    const groups = groupPendingCashOuts([
      { id: "d1", payrollRunId: "run1", period: "SECOND_HALF", amount: 200, status: "PAID", cashMovementId: null, scheduledDate: JUL_30 },
    ], JUL_30);
    assert.equal(groups[0].reason, "Nómina 2da quincena (1 empleado)");
  });
});

describe("groupPendingCashOuts: etiqueta de aplicación tardía (bug reportado)", () => {
  test("misma fecha calendario (UTC) que scheduledDate -> no se marca como tardía, reason normal", () => {
    const groups = groupPendingCashOuts([
      { id: "d1", payrollRunId: "run1", period: "FIRST_HALF", amount: 18000, status: "PAID", cashMovementId: null, scheduledDate: JUL_15 },
    ], JUL_15);
    assert.equal(groups[0].appliedLate, false);
    assert.equal(groups[0].reason, "Nómina 1ra quincena (1 empleado)");
  });

  test("aplicado un dia despues del 15 (quedo pendiente de caja) -> se marca tardia con la fecha real", () => {
    // Caso exacto reportado: la quincena del 15 se pagó/aprobó ese día pero
    // no había caja abierta para descontarla — quedó pendiente hasta que el
    // 30 se abrió una caja y arrastró el gasto. Antes se veía igual que un
    // gasto normal de HOY (sorpresa); ahora queda explícito de dónde viene.
    const groups = groupPendingCashOuts([
      { id: "d1", payrollRunId: "run1", period: "FIRST_HALF", amount: 18000, status: "PAID", cashMovementId: null, scheduledDate: JUL_15 },
    ], JUL_30);
    assert.equal(groups[0].appliedLate, true);
    assert.equal(groups[0].reason, "Nómina 1ra quincena — correspondiente al 15 jul 2026 (aplicada con retraso, 1 empleado)");
  });

  test("la quincena del mes en curso (aplicada el mismo dia 30) y la del 15 arrastrada NO se confunden entre si", () => {
    // Reproduce el escenario completo del reporte: hoy (30) se paga la 2da
    // quincena (a tiempo) Y de paso se arrastra la 1ra que quedó pendiente
    // del 15 — deben quedar como DOS movimientos con reason distinguible,
    // nunca sumados/mezclados en uno solo "de hoy".
    const groups = groupPendingCashOuts([
      { id: "d1", payrollRunId: "run1", period: "FIRST_HALF", amount: 18000, status: "PAID", cashMovementId: null, scheduledDate: JUL_15 },
      { id: "d2", payrollRunId: "run1", period: "SECOND_HALF", amount: 18000, status: "PAID", cashMovementId: null, scheduledDate: JUL_30 },
    ], JUL_30);

    assert.equal(groups.length, 2, "dos grupos separados, nunca un solo total combinado");
    const first = groups.find((g) => g.period === "FIRST_HALF")!;
    const second = groups.find((g) => g.period === "SECOND_HALF")!;
    assert.equal(first.appliedLate, true, "la del 15 arrastrada se marca tardia");
    assert.equal(second.appliedLate, false, "la del 30 es la que corresponde a hoy, no es tardia");
    assert.match(first.reason, /correspondiente al 15 jul 2026/);
    assert.doesNotMatch(second.reason, /correspondiente al/);
  });
});
