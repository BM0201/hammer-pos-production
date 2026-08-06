import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { okCached } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { computeCategoryStats, type ExpenseRecord } from "@/modules/finance/expense-intelligence";

/** Meses de historial que alimentan el presupuesto inteligente. */
const HISTORY_MONTHS = 6;

/**
 * GET /api/finance/expense-history?branchId=xxx — historial de gastos REALES
 * por categoría (últimos 6 meses): último pago, promedio mensual y presupuesto
 * SUGERIDO. Solo cuentan gastos efectivamente pagados desde caja
 * (cashMovementId) — el presupuesto se arma con lo que de verdad se gasta,
 * no con estimaciones. PAYROLL queda fuera: tiene su propio panel.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertFinanceAccess(session!);

    const branchId = new URL(req.url).searchParams.get("branchId") || undefined;
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - HISTORY_MONTHS);

    const rows = await prisma.operatingExpense.findMany({
      where: {
        category: { not: "PAYROLL" },
        cashMovementId: { not: null },
        effectiveFrom: { gte: since },
        ...(branchId ? { branchId } : {}),
      },
      select: { category: true, amount: true, effectiveFrom: true, description: true },
      orderBy: { effectiveFrom: "asc" },
    });

    const byCategory = new Map<string, ExpenseRecord[]>();
    for (const row of rows) {
      const list = byCategory.get(row.category) ?? [];
      list.push({ amount: Number(row.amount), date: row.effectiveFrom, description: row.description });
      byCategory.set(row.category, list);
    }

    const categories = [...byCategory.entries()]
      .map(([category, records]) => computeCategoryStats(category, records))
      .sort((a, b) => b.monthlyAverage - a.monthlyAverage);

    return okCached({ historyMonths: HISTORY_MONTHS, categories }, 120);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
