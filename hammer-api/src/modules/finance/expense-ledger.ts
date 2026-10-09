import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isCountableTreasuryExpenseEntry, payrollEmployerCostPaid } from "@/modules/finance/expense-rules";
import { splitRangeByManaguaMonth } from "@/modules/finance/periods";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * prompt-gastos-semana-quincena.md Fase 2.2 — libro único de gastos: TODAS
 * las fuentes normalizadas a la MISMA forma de fila. Las fuentes son las
 * mismas que ya usa computeRealPerformance (finance/service.ts) — a
 * propósito, no se inventan otras: caja, banco/retenido (vía
 * isCountableTreasuryExpenseEntry, la MISMA regla, extraída), comisión de
 * tarjeta (un entryType más dentro de esa misma consulta) y planilla
 * pagada a costo empresa.
 */
export type ExpenseLedgerSource = "CAJA" | "EFECTIVO_RETENIDO" | "BANCO" | "COMISION_TARJETA" | "PLANILLA" | "DEVENGADO";

export type ExpenseLedgerRow = {
  id: string;
  date: Date;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  category: string;
  conceptId: string | null;
  conceptName: string | null;
  description: string;
  payee: string | null;
  receiptNumber: string | null;
  amount: number;
  source: ExpenseLedgerSource;
  registeredBy: string | null;
  approvedBy: string | null;
  reference: { type: string; id: string; href: string | null } | null;
  /** Solo basis=ACCRUED, source=DEVENGADO: "C$ 15,000 alquiler × 7/31 días". */
  explanation?: string;
};

const UNCLASSIFIED_CATEGORY = "UNCLASSIFIED";

function num(value: Prisma.Decimal | number | null | undefined): number {
  return Number(value ?? 0);
}

async function loadBranchMap(db: DbClient) {
  const branches = await db.branch.findMany({ select: { id: true, code: true, name: true } });
  return new Map(branches.map((b) => [b.id, b]));
}

async function loadUserMap(db: DbClient, userIds: Array<string | null | undefined>) {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map<string, string>();
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

/** Filas de CAJA — mismo filtro EXACTO que cashExpenseMovs en computeRealPerformance. */
async function loadCashRows(db: DbClient, branchId: string | null, start: Date, end: Date): Promise<ExpenseLedgerRow[]> {
  const movements = await db.cashMovement.findMany({
    where: {
      type: "EXPENSE_OUT",
      createdAt: { gte: start, lt: end },
      payrollDisbursements: { none: {} },
      operatingExpense: { isNot: { category: "PAYROLL" } },
      ...(branchId ? { cashSession: { physicalCashBox: { branchId } } } : {}),
    },
    select: {
      id: true,
      amount: true,
      createdAt: true,
      reason: true,
      createdByUserId: true,
      approvedByUserId: true,
      cashSession: { select: { physicalCashBox: { select: { branchId: true } } } },
      operatingExpense: {
        select: {
          category: true,
          description: true,
          payee: true,
          receiptNumber: true,
          conceptId: true,
          concept: { select: { name: true } },
        },
      },
    },
  });

  const branchMap = await loadBranchMap(db);
  const userMap = await loadUserMap(db, movements.flatMap((m) => [m.createdByUserId, m.approvedByUserId]));

  return movements.map((m) => {
    const resolvedBranchId = m.cashSession.physicalCashBox.branchId;
    const branch = branchMap.get(resolvedBranchId);
    const linked = m.operatingExpense;
    return {
      id: m.id,
      date: m.createdAt,
      branchId: resolvedBranchId,
      branchCode: branch?.code ?? null,
      branchName: branch?.name ?? null,
      category: linked?.category ?? UNCLASSIFIED_CATEGORY,
      conceptId: linked?.conceptId ?? null,
      conceptName: linked?.concept?.name ?? null,
      description: linked?.description ?? m.reason,
      payee: linked?.payee ?? null,
      receiptNumber: linked?.receiptNumber ?? null,
      amount: num(m.amount),
      source: "CAJA" as const,
      registeredBy: userMap.get(m.createdByUserId) ?? null,
      approvedBy: m.approvedByUserId ? (userMap.get(m.approvedByUserId) ?? null) : null,
      reference: { type: "CashMovement", id: m.id, href: null },
    };
  });
}

/** Filas de BANCO/EFECTIVO_RETENIDO/COMISIÓN_TARJETA — misma consulta base que fetchTreasuryExpenseEntries, select más rico, MISMA regla de conteo (isCountableTreasuryExpenseEntry). */
async function loadTreasuryRows(db: DbClient, branchId: string | null, start: Date, end: Date): Promise<ExpenseLedgerRow[]> {
  const entries = await db.treasuryEntry.findMany({
    where: {
      direction: "OUT",
      entryType: { in: ["EXPENSE", "SUPPLIER_PAYMENT", "CARD_FEE"] },
      occurredAt: { gte: start, lt: end },
      ...(branchId ? { account: { is: { branchId } } } : {}),
    },
    select: {
      id: true,
      amount: true,
      occurredAt: true,
      expensePaymentId: true,
      purchaseOrderId: true,
      entryType: true,
      counterpartyName: true,
      reference: true,
      createdByUserId: true,
      account: { select: { branchId: true, type: true } },
    },
  });

  const expensePaymentIds = entries.map((e) => e.expensePaymentId).filter((id): id is string => id !== null);
  const linkedExpenses = expensePaymentIds.length > 0
    ? await db.operatingExpense.findMany({
        where: { id: { in: expensePaymentIds } },
        select: { id: true, category: true, isActive: true, description: true, payee: true, receiptNumber: true, conceptId: true, concept: { select: { name: true } } },
      })
    : [];
  const linkedById = new Map(linkedExpenses.map((e) => [e.id, e]));

  const countable = entries.filter((e) => isCountableTreasuryExpenseEntry(e, linkedById.get(e.expensePaymentId ?? "")));

  const branchMap = await loadBranchMap(db);
  const userMap = await loadUserMap(db, countable.map((e) => e.createdByUserId));

  return countable.map((e) => {
    const linked = e.expensePaymentId ? linkedById.get(e.expensePaymentId) : undefined;
    const branch = e.account.branchId ? branchMap.get(e.account.branchId) : undefined;
    const source: ExpenseLedgerSource = e.entryType === "CARD_FEE" ? "COMISION_TARJETA" : e.account.type === "SAFE" ? "EFECTIVO_RETENIDO" : "BANCO";
    return {
      id: e.id,
      date: e.occurredAt,
      branchId: e.account.branchId,
      branchCode: branch?.code ?? null,
      branchName: branch?.name ?? null,
      category: linked?.category ?? UNCLASSIFIED_CATEGORY,
      conceptId: linked?.conceptId ?? null,
      conceptName: linked?.concept?.name ?? null,
      description: linked?.description ?? e.counterpartyName ?? e.reference ?? "Sin descripción",
      payee: linked?.payee ?? e.counterpartyName ?? null,
      receiptNumber: linked?.receiptNumber ?? null,
      amount: num(e.amount),
      source,
      registeredBy: userMap.get(e.createdByUserId) ?? null,
      approvedBy: null,
      reference: { type: "TreasuryEntry", id: e.id, href: null },
    };
  });
}

/** Filas de PLANILLA pagada — a costo EMPRESA (payrollEmployerCostPaid), mismo criterio que computeRealPerformance. */
async function loadPayrollPaidRows(db: DbClient, branchId: string | null, start: Date, end: Date): Promise<ExpenseLedgerRow[]> {
  const disbursements = await db.payrollDisbursement.findMany({
    where: { status: "PAID", paidAt: { gte: start, lt: end }, ...(branchId ? { branchId } : {}) },
    select: {
      id: true,
      amount: true,
      paidAt: true,
      branchId: true,
      paidByUserId: true,
      employee: { select: { fullName: true } },
      payrollLine: { select: { netPay: true, employerCost: true } },
    },
  });

  const branchMap = await loadBranchMap(db);
  const userMap = await loadUserMap(db, disbursements.map((d) => d.paidByUserId));

  return disbursements.map((d) => {
    const branch = branchMap.get(d.branchId);
    return {
      id: d.id,
      date: d.paidAt ?? new Date(),
      branchId: d.branchId,
      branchCode: branch?.code ?? null,
      branchName: branch?.name ?? null,
      category: "PAYROLL",
      conceptId: null,
      conceptName: null,
      description: `Costo laboral: ${d.employee.fullName}`,
      payee: d.employee.fullName,
      receiptNumber: null,
      amount: payrollEmployerCostPaid(d),
      source: "PLANILLA" as const,
      registeredBy: d.paidByUserId ? (userMap.get(d.paidByUserId) ?? null) : null,
      approvedBy: null,
      reference: { type: "PayrollDisbursement", id: d.id, href: null },
    };
  });
}

export async function getExpenseLedger(
  input: { start: Date; end: Date; branchId: string | null; basis: "PAID" | "ACCRUED" },
  db: DbClient = prisma,
): Promise<{ rows: ExpenseLedgerRow[] }> {
  const { start, end, branchId } = input;

  if (input.basis === "PAID") {
    const [cashRows, treasuryRows, payrollRows] = await Promise.all([
      loadCashRows(db, branchId, start, end),
      loadTreasuryRows(db, branchId, start, end),
      loadPayrollPaidRows(db, branchId, start, end),
    ]);
    const rows = [...cashRows, ...treasuryRows, ...payrollRows].sort((a, b) => a.date.getTime() - b.date.getTime());
    return { rows };
  }

  // ACCRUED — ver accrueExpenses más abajo.
  const rows = await accrueExpenses(db, { start, end, branchId });
  return { rows };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ACCRUED — "lo que le costó al negocio", no "lo que salió de la plata".
 * prompt-gastos-semana-quincena.md Fase 2.3.
 * ═══════════════════════════════════════════════════════════════════════════ */

function formatAmount(amount: number): string {
  return `C$${amount.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Costo laboral DEVENGADO: totalEmployerCost de cada PayrollRun POSTED prorrateado por los días del período dentro de ESE mes. */
async function accruePayroll(db: DbClient, input: { start: Date; end: Date; branchId: string | null }): Promise<ExpenseLedgerRow[]> {
  const segments = splitRangeByManaguaMonth(input.start, input.end);
  const branchMap = await loadBranchMap(db);
  const rows: ExpenseLedgerRow[] = [];

  for (const seg of segments) {
    const runs = await db.payrollRun.findMany({
      where: { year: seg.year, month: seg.month, status: "POSTED", ...(input.branchId ? { branchId: input.branchId } : {}) },
      select: { id: true, branchId: true, totalEmployerCost: true },
    });
    for (const run of runs) {
      const monthlyCost = num(run.totalEmployerCost);
      if (monthlyCost <= 0) continue;
      const amount = monthlyCost * (seg.daysInSegment / seg.daysInMonth);
      const branch = run.branchId ? branchMap.get(run.branchId) : undefined;
      rows.push({
        id: `${run.id}:${seg.year}-${seg.month}`,
        date: seg.start,
        branchId: run.branchId,
        branchCode: branch?.code ?? null,
        branchName: branch?.name ?? null,
        category: "PAYROLL",
        conceptId: null,
        conceptName: null,
        description: `Costo laboral devengado — planilla ${seg.month}/${seg.year}`,
        payee: null,
        receiptNumber: null,
        amount,
        source: "DEVENGADO",
        registeredBy: null,
        approvedBy: null,
        reference: { type: "PayrollRun", id: run.id, href: null },
        explanation: `${formatAmount(monthlyCost)} costo laboral × ${seg.daysInSegment}/${seg.daysInMonth} días`,
      });
    }
  }
  return rows;
}

/**
 * Gastos RECURRING (presupuesto, ej. alquiler) prorrateados por días —
 * SALVO que un PAID ya cubra la misma categoría+concepto en este período
 * exacto (ahí se usa el pagado, no se duplica con el prorrateo).
 * "paidCategoryConceptKeys" lo arma el caller (loadCashRows+loadTreasuryRows,
 * ya resueltos para este mismo período) — un Set de "category:conceptId".
 *
 * Exportada (sin Set, o con uno vacío) para expense-period-report.ts: el
 * PRESUPUESTO del período es este mismo prorrateo pero SIN el salto por
 * pago real — el presupuesto es "cuánto DEBERÍA costar este período",
 * independiente de si ya se pagó o no (eso se compara aparte, como %
 * ejecutado). El libro ACCRUED sí salta para no duplicar el gasto real.
 */
export async function accrueRecurring(
  db: DbClient,
  input: { start: Date; end: Date; branchId: string | null },
  paidCategoryConceptKeys: Set<string> = new Set(),
): Promise<ExpenseLedgerRow[]> {
  const recurring = await db.operatingExpense.findMany({
    where: {
      kind: "RECURRING",
      isActive: true,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      effectiveFrom: { lt: input.end },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.start } }],
    },
    select: {
      id: true, branchId: true, category: true, description: true, amount: true,
      conceptId: true, concept: { select: { name: true } },
    },
  });

  const branchMap = await loadBranchMap(db);
  const rows: ExpenseLedgerRow[] = [];

  for (const exp of recurring) {
    const key = `${exp.category}:${exp.conceptId ?? ""}`;
    if (paidCategoryConceptKeys.has(key)) continue; // ya cubierto por un pago real en este período.

    const monthlyAmount = num(exp.amount);
    const segments = splitRangeByManaguaMonth(input.start, input.end);
    const branch = branchMap.get(exp.branchId);
    for (const seg of segments) {
      const amount = monthlyAmount * (seg.daysInSegment / seg.daysInMonth);
      rows.push({
        id: `${exp.id}:${seg.year}-${seg.month}`,
        date: seg.start,
        branchId: exp.branchId,
        branchCode: branch?.code ?? null,
        branchName: branch?.name ?? null,
        category: exp.category,
        conceptId: exp.conceptId,
        conceptName: exp.concept?.name ?? null,
        description: exp.description,
        payee: null,
        receiptNumber: null,
        amount,
        source: "DEVENGADO",
        registeredBy: null,
        approvedBy: null,
        reference: { type: "OperatingExpense", id: exp.id, href: null },
        explanation: `${formatAmount(monthlyAmount)} ${exp.description} × ${seg.daysInSegment}/${seg.daysInMonth} días`,
      });
    }
  }
  return rows;
}

async function accrueExpenses(db: DbClient, input: { start: Date; end: Date; branchId: string | null }): Promise<ExpenseLedgerRow[]> {
  const [cashRows, treasuryRows, accruedPayroll] = await Promise.all([
    loadCashRows(db, input.branchId, input.start, input.end),
    loadTreasuryRows(db, input.branchId, input.start, input.end),
    accruePayroll(db, input),
  ]);

  const paidRows = [...cashRows, ...treasuryRows];
  const paidCategoryConceptKeys = new Set(paidRows.map((r) => `${r.category}:${r.conceptId ?? ""}`));
  const accruedRecurring = await accrueRecurring(db, input, paidCategoryConceptKeys);

  return [...paidRows, ...accruedPayroll, ...accruedRecurring].sort((a, b) => a.date.getTime() - b.date.getTime());
}
