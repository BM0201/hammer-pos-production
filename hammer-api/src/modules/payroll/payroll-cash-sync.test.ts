/**
 * Run: npx tsx --test src/modules/payroll/payroll-cash-sync.test.ts
 *
 * Replica en puro TS (sin Prisma) la lógica de agrupamiento de
 * applyPendingPayrollCashOuts: agrupa PayrollDisbursement PAID con
 * cashMovementId=null por payrollRunId+period, sumando el monto por grupo.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

type Disbursement = {
  id: string;
  payrollRunId: string;
  period: "FIRST_HALF" | "SECOND_HALF";
  amount: number;
  status: "PENDING" | "PAID";
  cashMovementId: string | null;
};

const PERIOD_LABEL: Record<string, string> = { FIRST_HALF: "1ra", SECOND_HALF: "2da" };

function groupPendingCashOuts(disbursements: Disbursement[]) {
  const pending = disbursements.filter((d) => d.status === "PAID" && d.cashMovementId === null);
  if (pending.length === 0) return [];

  const groups = new Map<string, Disbursement[]>();
  for (const d of pending) {
    const key = `${d.payrollRunId}:${d.period}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  const result: Array<{ payrollRunId: string; period: string; total: number; employeeCount: number; reason: string }> = [];
  for (const [key, rows] of groups) {
    const [payrollRunId, period] = key.split(":");
    const total = rows.reduce((s, r) => s + r.amount, 0);
    if (total <= 0) continue;
    result.push({
      payrollRunId,
      period,
      total,
      employeeCount: rows.length,
      reason: `Nómina ${PERIOD_LABEL[period] ?? period} quincena (${rows.length} empleado${rows.length === 1 ? "" : "s"})`,
    });
  }
  return result;
}

describe("groupPendingCashOuts (agrupamiento de payroll-cash-sync)", () => {
  it("agrupa varios disbursements PAID del mismo run+period en un único total", () => {
    const groups = groupPendingCashOuts([
      { id: "d1", payrollRunId: "run1", period: "FIRST_HALF", amount: 500, status: "PAID", cashMovementId: null },
      { id: "d2", payrollRunId: "run1", period: "FIRST_HALF", amount: 750, status: "PAID", cashMovementId: null },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].total, 1250);
    assert.equal(groups[0].employeeCount, 2);
    assert.equal(groups[0].reason, "Nómina 1ra quincena (2 empleados)");
  });

  it("separa grupos distintos por period dentro del mismo run", () => {
    const groups = groupPendingCashOuts([
      { id: "d1", payrollRunId: "run1", period: "FIRST_HALF", amount: 300, status: "PAID", cashMovementId: null },
      { id: "d2", payrollRunId: "run1", period: "SECOND_HALF", amount: 300, status: "PAID", cashMovementId: null },
    ]);
    assert.equal(groups.length, 2);
    assert.ok(groups.some((g) => g.period === "FIRST_HALF" && g.total === 300));
    assert.ok(groups.some((g) => g.period === "SECOND_HALF" && g.total === 300));
  });

  it("ignora disbursements PENDING (no pagados) y los ya aplicados (cashMovementId != null)", () => {
    const groups = groupPendingCashOuts([
      { id: "d1", payrollRunId: "run1", period: "FIRST_HALF", amount: 500, status: "PENDING", cashMovementId: null },
      { id: "d2", payrollRunId: "run1", period: "FIRST_HALF", amount: 500, status: "PAID", cashMovementId: "cm1" },
    ]);
    assert.equal(groups.length, 0);
  });

  it("singular correcto en el texto cuando hay un solo empleado", () => {
    const groups = groupPendingCashOuts([
      { id: "d1", payrollRunId: "run1", period: "SECOND_HALF", amount: 200, status: "PAID", cashMovementId: null },
    ]);
    assert.equal(groups[0].reason, "Nómina 2da quincena (1 empleado)");
  });
});
