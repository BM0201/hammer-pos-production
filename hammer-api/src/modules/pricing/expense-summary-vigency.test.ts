import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { getExpenseSummaryByBranch, getExpenseSummaryAllBranches } from "@/modules/pricing/service";

/**
 * Auditoría 2026-07-22, hallazgo C6: getExpenseSummaryByBranch/getExpenseSummaryAllBranches
 * sumaban TODOS los OperatingExpense activos sin filtrar vigencia (effectiveFrom/effectiveTo),
 * a diferencia de getMonthlyExpensesByBranch (que sí filtra correctamente). Como la
 * sincronización de planilla crea un registro nuevo por mes y nunca desactiva los
 * anteriores, el total mostrado en "Gastos operativos" crecía sin límite mes tras mes.
 *
 * Caso numérico: 3 meses de planilla (mayo/junio/julio) de C$10,000 cada uno, "hoy" es
 * julio. Antes del fix: total = C$30,000 (acumulado). Después: total = C$10,000 (solo julio).
 */
const NOW = new Date("2026-07-22T12:00:00.000Z");

function decimal(value: number) {
  return new Prisma.Decimal(value);
}

function createFakeDb(expenses: Array<{
  id: string;
  branchId: string;
  category: string;
  amount: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}>) {
  function matches(exp: (typeof expenses)[number], where: { branchId?: string; isActive: true }) {
    if (where.branchId && exp.branchId !== where.branchId) return false;
    const inWindow = exp.effectiveFrom.getTime() <= NOW.getTime() && (exp.effectiveTo === null || exp.effectiveTo.getTime() >= NOW.getTime());
    return inWindow;
  }

  return {
    operatingExpense: {
      findMany: async ({ where }: { where: { branchId?: string; isActive: true } }) => {
        return expenses
          .filter((exp) => matches(exp, where))
          .map((exp) => ({
            id: exp.id,
            branchId: exp.branchId,
            category: exp.category,
            description: exp.category,
            amount: decimal(exp.amount),
            branch: { id: exp.branchId, code: exp.branchId, name: exp.branchId },
          }));
      },
      groupBy: async ({ where }: { where: { isActive: true } }) => {
        const inWindow = expenses.filter((exp) => matches(exp, where));
        const byKey = new Map<string, number>();
        for (const exp of inWindow) {
          const key = `${exp.branchId}:${exp.category}`;
          byKey.set(key, (byKey.get(key) ?? 0) + exp.amount);
        }
        return Array.from(byKey.entries()).map(([key, sum]) => {
          const [branchId, category] = key.split(":");
          return { branchId, category, _sum: { amount: decimal(sum) } };
        });
      },
    },
    branch: {
      findMany: async () => [{ id: "branch-1", code: "MSY", name: "Masaya" }],
    },
  } as unknown as Parameters<typeof getExpenseSummaryByBranch>[1];
}

test("getExpenseSummaryByBranch: no acumula meses ya vencidos — solo cuenta el gasto vigente", async () => {
  const db = createFakeDb([
    { id: "e-may", branchId: "branch-1", category: "PAYROLL", amount: 10000, effectiveFrom: new Date("2026-05-01T00:00:00Z"), effectiveTo: new Date("2026-05-31T23:59:59Z") },
    { id: "e-jun", branchId: "branch-1", category: "PAYROLL", amount: 10000, effectiveFrom: new Date("2026-06-01T00:00:00Z"), effectiveTo: new Date("2026-06-30T23:59:59Z") },
    { id: "e-jul", branchId: "branch-1", category: "PAYROLL", amount: 10000, effectiveFrom: new Date("2026-07-01T00:00:00Z"), effectiveTo: new Date("2026-07-31T23:59:59Z") },
  ]);

  const summary = await getExpenseSummaryByBranch("branch-1", db);

  assert.equal(summary.grandTotal, 10000, "solo julio (vigente) debe contar, no los 3 meses acumulados (30000)");
  assert.equal(summary.totalExpenses, 1);
});

test("getExpenseSummaryAllBranches: mismo filtro de vigencia en la vista consolidada", async () => {
  const db = createFakeDb([
    { id: "e-may", branchId: "branch-1", category: "PAYROLL", amount: 10000, effectiveFrom: new Date("2026-05-01T00:00:00Z"), effectiveTo: new Date("2026-05-31T23:59:59Z") },
    { id: "e-jul", branchId: "branch-1", category: "PAYROLL", amount: 10000, effectiveFrom: new Date("2026-07-01T00:00:00Z"), effectiveTo: new Date("2026-07-31T23:59:59Z") },
  ]);

  const summary = await getExpenseSummaryAllBranches(db);

  assert.equal(summary.grandTotal, 10000, "el mes de mayo ya vencido no debe sumarse en la vista de todas las sucursales");
});

test("getExpenseSummaryByBranch: un gasto sin effectiveTo (indefinido) sigue contando mientras esté vigente", async () => {
  const db = createFakeDb([
    { id: "e-open", branchId: "branch-1", category: "RENT", amount: 5000, effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null },
  ]);

  const summary = await getExpenseSummaryByBranch("branch-1", db);

  assert.equal(summary.grandTotal, 5000);
});
