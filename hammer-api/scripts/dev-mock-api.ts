/**
 * Servidor MOCK del backend para previsualizar el frontend SIN base de datos.
 *
 * Uso (dos terminales):
 *   1. hammer-api:      npm run dev:mock          (este servidor, puerto 4000)
 *   2. hammer-frontend: npm run dev               (Next.js, puerto 3000)
 *   3. Navegador:       http://localhost:3000/api/dev/login
 *      → setea la cookie de sesión (Master) y redirige a Finanzas › Planilla.
 *
 * Qué hace:
 *  - Emula el envelope { ok, data } del backend real.
 *  - /api/employees calcula payrollEstimate con los MÓDULOS PUROS REALES
 *    (payroll-nicaragua.ts + prestaciones-sociales.ts): lo que se ve en el
 *    panel es la aritmética legal de verdad, no números inventados.
 *  - Datos en memoria: 3 empleados reales (Carolina/Harry/Marvin) en la
 *    sucursal Central + 2 de demo en la sucursal "Demo antigüedad" para ver
 *    los tramos del Art. 45 (4–6 años: 5.556%; 7+ años: tope 0%).
 *  - Mutaciones (crear/editar/desactivar empleado, PATCH de config) editan la
 *    memoria del proceso: reiniciar el script restaura el estado inicial.
 *  - Cualquier endpoint no implementado responde ok(null) y se loguea, para
 *    que el resto del shell no reviente.
 *
 * SOLO para desarrollo local. No toca Prisma ni requiere DATABASE_URL.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_PAYROLL_RATES,
  IR_TABLE_ANNUAL,
  computePayrollLineBreakdown,
  resolveInssRates,
  round2,
  type BenefitAccrualMode,
  type InssRegime,
  type PayrollRates,
} from "../src/modules/payroll/payroll-nicaragua";
import {
  aguinaldoAccrued,
  aguinaldoPaymentDeadline,
  currentVacationPeriod,
  indemnizacionAccrualRate,
  indemnizacionAccruedTotal,
  indemnizacionPayout,
  monthsOfService,
  vacationDaysAccrued,
  vacationPayout,
} from "../src/modules/payroll/prestaciones-sociales";
import { checkOutlier, computeCategoryStats } from "../src/modules/finance/expense-intelligence";
import { calculateReconciliation, calculateTimber, calculateTimberTrip, DEFAULT_CLASSIFICATION_CONFIG, DEFAULT_PRICING } from "../src/modules/timber/calculator";
import { buildCatalogExportWorkbookFromRows } from "../src/modules/catalog-inventory/export-service";
import { calculatePricingSuggestion } from "../src/modules/pricing/calculator";

const PORT = Number(process.env.PORT) || 4000;
const SESSION_COOKIE = "__Host-hammer_session=dev-preview; Path=/; Secure; HttpOnly; SameSite=Lax";

/* ── Madera: viajes con la aritmética real y un catálogo corto, nombres en varas como el real ── */

type MockTripBody = { lines?: Array<{ thickness: number; width: number; length: number; pieces: number }>; woodTripTotalCost?: number; costPerFoot?: number; expenses?: Record<string, number>; invoicedFeet?: number | null; pricePolicy?: string; supplierName?: string | null; origin?: string | null };
type MockTrip = { id: string; tripCode: string; status: string; destinationBranchId: string; createdAt: string; body: MockTripBody };
const mockTrips: MockTrip[] = [];
const mockWood = [
  { id: "wood-tabla", sku: "MAD-TAB-1126-0001", name: "TABLA 1X12X6", subtype: "TABLA", t: 1, w: 12, varas: 6, stock: 270, price: 1360, cost: 1150 },
  { id: "wood-regla", sku: "MAD-REG-136-0001", name: "REGLA 1X3X6", subtype: "REGLA", t: 1, w: 3, varas: 6, stock: 3, price: 300, cost: 260 },
  { id: "wood-cuarton", sku: "MAD-CUA-246-0001", name: "CUARTON 2X4X6", subtype: "CUARTON", t: 2, w: 4, varas: 6, stock: 116, price: 706, cost: 590 },
  { id: "wood-tablilla", sku: "MAD-TAB-163-0001", name: "TABLILLA 1X6X3", subtype: "TABLILLA", t: 1, w: 6, varas: 3, stock: 7, price: 265, cost: 111 },
];
const MOCK_FEET_BY_VARAS: Record<number, number> = { 3: 8, 4: 11, 5: 14, 6: 16 };
const mockFixedCostPerFoot = new Map<string, number>();

function mockNextTripCode() {
  return `VJM-2026-${String(mockTrips.filter((t) => t.status === "TRANSFERRED").length + 1).padStart(3, "0")}`;
}

function mockTripDetail(trip: MockTrip) {
  const lines = trip.body.lines ?? [];
  const calc = calculateTimberTrip(lines, trip.body.woodTripTotalCost ?? 0, DEFAULT_PRICING, { costPerFootInput: trip.body.costPerFoot, expenses: trip.body.expenses });
  return {
    ...trip,
    ...trip.body,
    destinationBranch: branches.find((b) => b.id === trip.destinationBranchId) ?? branches[0],
    ...calc.totals,
    totalCost: calc.totals.totalCostFeet,
    marginPercent: calc.totals.globalMarginPct,
    pricePolicy: trip.body.pricePolicy ?? "RECALC_FROM_PRICE_PER_INCH",
    invoicedFeet: trip.body.invoicedFeet ?? null,
    freightAmount: trip.body.expenses?.freightAmount ?? 0, fuelAmount: trip.body.expenses?.fuelAmount ?? 0, perDiemAmount: trip.body.expenses?.perDiemAmount ?? 0, permitsAmount: trip.body.expenses?.permitsAmount ?? 0, otherExpensesAmount: trip.body.expenses?.otherExpensesAmount ?? 0,
    supplierName: trip.body.supplierName ?? null,
    origin: trip.body.origin ?? null,
    reconciliation: calculateReconciliation(calc.totals.totalFeet, trip.body.invoicedFeet ?? null, 0.01),
    nextTripCode: trip.status === "DRAFT" ? mockNextTripCode() : null,
    lines: calc.lines.map((line, i) => ({ id: `line-${i}`, thicknessIn: line.dimensions.thickness, widthIn: line.dimensions.width, lengthIn: line.dimensions.length, ...line })),
  };
}

function mockTripPreview(trip: MockTrip) {
  return {
    tripId: trip.id, tripCode: trip.tripCode, pricePolicy: trip.body.pricePolicy, hash: "mock",
    lines: mockTripDetail(trip).lines.map((line) => {
      const wood = mockWood.find((w) => w.t === line.thicknessIn && w.w === line.widthIn && w.varas === line.varaLength);
      const before = wood?.price ?? null;
      const after = trip.body.pricePolicy === "COST_ONLY" ? (before ?? line.calculatedSalePricePerPiece) : line.calculatedSalePricePerPiece;
      return {
        lineId: line.id, dimensions: line.dimensions, isNewProduct: !wood, productName: wood?.name ?? `CUARTON ${line.thicknessIn}X${line.widthIn}X${line.varaLength}`, sku: wood?.sku ?? null, piecesToAdd: line.pieces,
        costPerPiece: { before: wood?.cost ?? null, after: line.calculatedCostPerPiece }, wac: { before: wood?.cost ?? null, after: line.calculatedCostPerPiece },
        branchCost: { before: null, after: line.calculatedCostPerPiece }, sellingPrice: { before, after },
      };
    }),
  };
}

/* ── Estado en memoria ──────────────────────────────────────────────────────── */

const branches = [
  { id: "br-central", code: "CEN", name: "Central" },
  { id: "br-demo", code: "DEMO", name: "Demo antigüedad" },
];

type MockEmployee = {
  id: string;
  fullName: string;
  position: string;
  branchId: string;
  monthlySalary: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  /** Retener IR salarial (varía por trabajador; los 3 reales tributan por su cuenta). */
  applyIrRetention: boolean;
  /** Salario COTIZABLE reportado al INSS (los reales están con 6,519.58). */
  inssSalary: string | null;
  /** Número de cédula de identidad. */
  nationalId: string | null;
  /** Última liquidación y recontratación (rollover) — null = nunca se liquidó. */
  lastLiquidationAt: string | null;
};

const employees: MockEmployee[] = [
  { id: "emp-carolina", fullName: "Carolina Méndez", position: "Vendedor", branchId: "br-central", monthlySalary: "10000", startDate: "2026-01-04T00:00:00.000Z", endDate: null, isActive: true, applyIrRetention: false, inssSalary: "6519.58", nationalId: "401-070390-0001A", lastLiquidationAt: null },
  { id: "emp-harry", fullName: "Harry López", position: "Supervisor", branchId: "br-central", monthlySalary: "12000", startDate: "2026-01-04T00:00:00.000Z", endDate: null, isActive: true, applyIrRetention: false, inssSalary: "6519.58", nationalId: "401-150988-0002B", lastLiquidationAt: null },
  { id: "emp-marvin", fullName: "Marvin Ruiz", position: "Bodeguero", branchId: "br-central", monthlySalary: "9500", startDate: "2026-03-15T00:00:00.000Z", endDate: null, isActive: true, applyIrRetention: false, inssSalary: "6519.58", nationalId: "401-220595-0003C", lastLiquidationAt: null },
  // Demo de tramos Art. 45 — mismo salario que Carolina para ver que cuestan distinto.
  // Diana además CON retención de IR, para ver la variación por trabajador:
  { id: "emp-diana", fullName: "Diana Castillo (4a 5m)", position: "Administrador", branchId: "br-demo", monthlySalary: "10000", startDate: "2022-02-01T00:00:00.000Z", endDate: null, isActive: true, applyIrRetention: true, inssSalary: null, nationalId: null, lastLiquidationAt: null },
  { id: "emp-ernesto", fullName: "Ernesto Vargas (7a — tope)", position: "Supervisor", branchId: "br-demo", monthlySalary: "10000", startDate: "2019-05-01T00:00:00.000Z", endDate: null, isActive: true, applyIrRetention: false, inssSalary: null, nationalId: null, lastLiquidationAt: null },
];

/** Liquidaciones registradas (ROLLOVER o TERMINATION) — historial en memoria. */
type MockSettlement = {
  id: string;
  employeeId: string;
  kind: "ROLLOVER" | "TERMINATION";
  causal: string | null;
  date: string;
  aguinaldoPaid: number;
  vacationDaysPaid: number;
  vacationValuePaid: number;
  indemnizacionPaid: number;
  loanDeduction: number;
  totalPaid: number;
  notes: string | null;
};
const settlements: MockSettlement[] = [];
const CAUSAL_PAYS_INDEMNIZACION: Record<string, boolean> = {
  DESPIDO_SIN_CAUSA: true,
  MUTUO_ACUERDO: true,
  RENUNCIA_CON_PREAVISO: true,
  DESPIDO_CON_CAUSA: false,
  RENUNCIA_SIN_PREAVISO: false,
};

/** Saldos de préstamos ACTIVOS (se descuentan al liquidar): Harry debe 2,000. */
const LOAN_OUTSTANDING: Record<string, number> = { "emp-harry": 2000 };

/** Ledger de vacaciones (reemplaza el contador suelto): días GOZADAS/PAGADAS con fecha. */
type MockVacationEntry = { id: string; employeeId: string; date: string; days: number; kind: string; notes: string | null };
const vacationEntries: MockVacationEntry[] = [
  { id: "vac-1", employeeId: "emp-diana", date: "2026-06-01T00:00:00.000Z", days: 20, kind: "GOZADAS", notes: "Saldo histórico migrado (demo)" },
  { id: "vac-2", employeeId: "emp-ernesto", date: "2026-06-01T00:00:00.000Z", days: 45, kind: "GOZADAS", notes: "Saldo histórico migrado (demo)" },
];
function vacationDaysTaken(employeeId: string): number {
  return round2(vacationEntries.filter((v) => v.employeeId === employeeId).reduce((sum, v) => sum + v.days, 0));
}

/** Pagos de facturas del patrón (INSS/INATEC) marcados en el preview. */
const contributionPayments: Array<{ id: string; year: number; month: number; kind: string; amount: string; paidAt: string }> = [];

/** Faltas registradas (asistencia): las INJUSTIFICADAS descuentan día de pago. */
type MockAbsence = { id: string; employeeId: string; date: string; kind: string; notes: string | null };
const absences: MockAbsence[] = [
  { id: "abs-1", employeeId: "emp-marvin", date: "2026-07-08T00:00:00.000Z", kind: "UNJUSTIFIED", notes: "No avisó" },
];

/** Pases de asistencia tomados (para que el modal solo aparezca 1 vez/día). */
type MockRollCall = {
  id: string;
  branchId: string;
  date: string;
  presentCount: number;
  absentCount: number;
  reviewStatus: "PENDING" | "CONFIRMED";
  reviewedByUserId: string | null;
  reviewedAt: string | null;
};
const rollCalls: MockRollCall[] = [];

type MockAttendanceMark = { id: string; rollCallId: string; employeeId: string; status: string; arrivalAt: string | null; notes: string | null };
/** PRESENT y PRESENT_LATE cuentan como "vino" — no generan falta. */
function attended(status: string): boolean {
  return status === "PRESENT" || status === "PRESENT_LATE";
}
const attendanceMarks: MockAttendanceMark[] = [];

function unjustifiedDays(employeeId: string, year: number, month: number): number {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return absences.filter((a) => a.employeeId === employeeId && a.kind === "UNJUSTIFIED" && a.date.startsWith(prefix)).length;
}

/* Cortes quincenales en memoria: dos mitades del NETO por empleado activo
   (misma regla que generateDisbursementsForRun). Se crean al arrancar. */
type MockDisbursement = {
  id: string;
  branchId: string;
  employeeId: string;
  period: "FIRST_HALF" | "SECOND_HALF";
  amount: string;
  status: "PENDING" | "PAID";
  scheduledDate: string;
  paidAt: string | null;
};
const disbursements: MockDisbursement[] = [];

/* Gastos operativos manuales en memoria (los de planilla se derivan SIEMPRE
   de los empleados activos con la aritmética real — ver payrollExpenses). */
type MockExpense = {
  id: string;
  branchId: string;
  category: string;
  description: string;
  amount: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
};
const manualExpenses: MockExpense[] = [
  { id: "exp-rent", branchId: "br-central", category: "RENT", description: "Alquiler del local", amount: "8000", isActive: true, effectiveFrom: "2026-07-01T00:00:00.000Z", effectiveTo: null },
  { id: "exp-luz", branchId: "br-central", category: "UTILITIES", description: "Luz + agua + internet", amount: "2500", isActive: true, effectiveFrom: "2026-07-01T00:00:00.000Z", effectiveTo: null },
];

/* Historial de gastos PAGADOS (para el presupuesto inteligente): meses previos
   sembrados para que el card muestre último gasto / promedio / sugerido y el
   aviso de montos atípicos tenga contra qué comparar. */
type MockPaidExpense = { branchId: string; category: string; description: string; amount: number; date: string };
const paidExpenseHistory: MockPaidExpense[] = [
  { branchId: "br-central", category: "UTILITIES", description: "Luz mayo (DISNORTE)", amount: 2400, date: "2026-05-10T00:00:00.000Z" },
  { branchId: "br-central", category: "UTILITIES", description: "Luz junio (DISNORTE)", amount: 2650, date: "2026-06-10T00:00:00.000Z" },
  { branchId: "br-central", category: "UTILITIES", description: "Agua junio (ENACAL)", amount: 480, date: "2026-06-12T00:00:00.000Z" },
  { branchId: "br-central", category: "FOOD", description: "Comida / refrigerio — almuerzos", amount: 350, date: "2026-06-05T00:00:00.000Z" },
  { branchId: "br-central", category: "FOOD", description: "Comida / refrigerio — café y agua", amount: 180, date: "2026-06-20T00:00:00.000Z" },
  { branchId: "br-central", category: "FOOD", description: "Comida / refrigerio", amount: 260, date: "2026-07-03T00:00:00.000Z" },
  { branchId: "br-central", category: "TRANSPORT", description: "Transporte / flete — acarreo hierro", amount: 600, date: "2026-06-08T00:00:00.000Z" },
  { branchId: "br-central", category: "TRANSPORT", description: "Transporte / flete — taxi banco", amount: 150, date: "2026-06-25T00:00:00.000Z" },
  { branchId: "br-central", category: "TRANSPORT", description: "Transporte / flete", amount: 400, date: "2026-07-02T00:00:00.000Z" },
  { branchId: "br-central", category: "RENT", description: "Alquiler del local", amount: 8000, date: "2026-05-01T00:00:00.000Z" },
  { branchId: "br-central", category: "RENT", description: "Alquiler del local", amount: 8000, date: "2026-06-01T00:00:00.000Z" },
  { branchId: "br-central", category: "RENT", description: "Alquiler del local", amount: 8000, date: "2026-07-01T00:00:00.000Z" },
  { branchId: "br-central", category: "TAXES", description: "Alcaldía (impuesto municipal)", amount: 1200, date: "2026-05-05T00:00:00.000Z" },
  { branchId: "br-central", category: "TAXES", description: "Alcaldía (impuesto municipal)", amount: 1200, date: "2026-06-05T00:00:00.000Z" },
  { branchId: "br-central", category: "TAXES", description: "DGI (impuestos)", amount: 950, date: "2026-06-14T00:00:00.000Z" },
];

function paidHistoryStats(branchId: string, category: string) {
  return computeCategoryStats(
    category,
    paidExpenseHistory
      .filter((e) => e.branchId === branchId && e.category === category)
      .map((e) => ({ amount: e.amount, date: new Date(e.date), description: e.description })),
  );
}

const config: { inssRegime: InssRegime; aguinaldoMode: BenefitAccrualMode; vacacionesMode: BenefitAccrualMode; indemnizacionMode: BenefitAccrualMode; salarioMinimoSectorial: number } = {
  inssRegime: "INTEGRAL",
  aguinaldoMode: "ACCRUE_MONTHLY",
  vacacionesMode: "ACCRUE_MONTHLY",
  indemnizacionMode: "ACCRUE_MONTHLY",
  salarioMinimoSectorial: 0,
};

function currentRates(): PayrollRates {
  return {
    ...DEFAULT_PAYROLL_RATES,
    ...config,
    activeEmployeeCount: employees.filter((e) => e.isActive).length,
  };
}

/* ── Réplica del estimado por empleado de listEmployees (payroll-service) ───── */

function withEstimate(emp: MockEmployee) {
  const rates = currentRates();
  const branch = branches.find((b) => b.id === emp.branchId) ?? branches[0];
  if (!emp.isActive) return { ...emp, branch, payrollEstimate: null, payrollRates: rates };

  const at = new Date();
  const salary = Number(emp.monthlySalary);
  // Ancla de antigüedad: si ya se liquidó-y-recontrató, el reloj se resetea
  // desde ahí (evita la "bola de nieve" de indemnización) — igual que en
  // payroll-service.ts.
  const anchor = emp.lastLiquidationAt ?? emp.startDate;
  const months = monthsOfService(anchor, at);
  const indemnizacionRate = indemnizacionAccrualRate(months);
  const b = computePayrollLineBreakdown({
    monthlySalary: salary,
    grossSalary: salary,
    daysWorked: 1,
    totalDays: 1,
    rates: { ...rates, aguinaldoMode: "ACCRUE_MONTHLY", vacacionesMode: "ACCRUE_MONTHLY", indemnizacionMode: "ACCRUE_MONTHLY" },
    indemnizacionRate,
    applyIrRetention: emp.applyIrRetention,
    inssMonthlySalary: emp.inssSalary != null ? Number(emp.inssSalary) : undefined,
  });
  const daysAccrued = vacationDaysAccrued(anchor, at);
  const daysTaken = vacationDaysTaken(emp.id);
  const vacationDaysBalance = round2(daysAccrued - daysTaken);
  const period = currentVacationPeriod(anchor, at);

  return {
    ...emp,
    branch,
    payrollEstimate: {
      inssLaboral: b.inssLaboral,
      ir: b.ir,
      netPay: b.netPay,
      inssPatronal: b.inssPatronal,
      inatec: b.inatec,
      dailyRate: b.dailyRate,
      provisions: b.provisions,
      aguinaldoAccrual: b.aguinaldoAccrual,
      vacacionesAccrual: b.vacacionesAccrual,
      indemnizacionAccrual: b.indemnizacionAccrual,
      employerCost: b.employerCost,
      monthsOfService: round2(months),
      aguinaldoAccrued: aguinaldoAccrued(salary, anchor, at),
      aguinaldoDeadline: aguinaldoPaymentDeadline(at).toISOString().slice(0, 10),
      vacationDaysAccrued: daysAccrued,
      vacationDaysTaken: daysTaken,
      vacationDaysBalance,
      vacationBalanceValue: vacationPayout(Math.max(0, vacationDaysBalance), salary),
      vacationPeriodIndex: period?.index ?? null,
      vacationPeriodAccrued: period?.accruedDays ?? 0,
      vacationPeriodStart: period?.start.toISOString().slice(0, 10) ?? null,
      vacationPeriodEnd: period?.end.toISOString().slice(0, 10) ?? null,
      indemnizacionAccrued: indemnizacionAccruedTotal(salary, anchor, at),
      indemnizacionRateActual: indemnizacionRate,
      belowMinimumWage: config.salarioMinimoSectorial > 0 && salary < config.salarioMinimoSectorial,
      // Perfil del trabajador: faltas del mes/año y préstamos pendientes.
      absencesMonthUnjustified: unjustifiedDays(emp.id, at.getFullYear(), at.getMonth() + 1),
      absencesMonthJustified: absences.filter((a) => a.employeeId === emp.id && a.kind === "JUSTIFIED" && a.date.startsWith(`${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`)).length,
      absencesYearUnjustified: absences.filter((a) => a.employeeId === emp.id && a.kind === "UNJUSTIFIED" && a.date.startsWith(String(at.getFullYear()))).length,
      loanOutstanding: LOAN_OUTSTANDING[emp.id] ?? 0,
    },
    payrollRates: rates,
  };
}

/* ── Gastos operativos y cortes derivados de los empleados ──────────────────── */

/** Único gasto de planilla: costo laboral mensual por empleado (como el real). */
function payrollExpenses(): MockExpense[] {
  return employees
    .filter((e) => e.isActive)
    .map((e) => {
      const est = withEstimate(e).payrollEstimate!;
      return {
        id: `exp-payroll-${e.id}`,
        branchId: e.branchId,
        category: "PAYROLL",
        description: `Costo laboral: ${e.fullName} (${e.position})`,
        amount: String(est.employerCost),
        isActive: true,
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveTo: "2026-07-31T23:59:59.999Z",
      };
    });
}

function allExpenses(): MockExpense[] {
  return [...payrollExpenses(), ...manualExpenses.filter((e) => e.isActive)];
}

function expenseSummaryFor(branchId: string) {
  const rows = allExpenses().filter((e) => e.branchId === branchId);
  const byCategory: Record<string, { total: number; count: number; items: unknown[] }> = {};
  let grandTotal = 0;
  for (const e of rows) {
    const branch = branches.find((b) => b.id === e.branchId);
    byCategory[e.category] = byCategory[e.category] ?? { total: 0, count: 0, items: [] };
    byCategory[e.category].total = round2(byCategory[e.category].total + Number(e.amount));
    byCategory[e.category].count += 1;
    byCategory[e.category].items.push({ ...e, branch });
    grandTotal = round2(grandTotal + Number(e.amount));
  }
  return { byCategory, grandTotal, totalExpenses: rows.length };
}

function allBranchesSummary() {
  const byBranch = branches.map((b) => {
    const rows = allExpenses().filter((e) => e.branchId === b.id);
    const byCategory: Record<string, number> = {};
    let total = 0;
    for (const e of rows) {
      byCategory[e.category] = round2((byCategory[e.category] ?? 0) + Number(e.amount));
      total = round2(total + Number(e.amount));
    }
    return { branchId: b.id, branchCode: b.code, branchName: b.name, byCategory, total };
  }).sort((a, b) => b.total - a.total);
  const grandTotal = round2(byBranch.reduce((s, b) => s + b.total, 0));
  const catTotals = new Map<string, number>();
  for (const b of byBranch) for (const [c, v] of Object.entries(b.byCategory)) catTotals.set(c, (catTotals.get(c) ?? 0) + v);
  const topCategory = [...catTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    grandTotal,
    branchesWithExpenses: byBranch.filter((b) => b.total > 0).length,
    totalBranches: branches.length,
    topCategory,
    byBranch,
  };
}

/** Dos quincenas PENDING por empleado activo (regla real: 1ª = ½ salario
 *  completo; las deducciones mensuales caen en la 2ª — biweekly-split.ts). */
function seedDisbursements() {
  for (const e of employees.filter((x) => x.isActive)) {
    const net = withEstimate(e).payrollEstimate!.netPay;
    const gross = Number(e.monthlySalary);
    const first = round2(Math.min(round2(gross / 2), net));
    const second = round2(net - first);
    disbursements.push(
      { id: `disb-${e.id}-1`, branchId: e.branchId, employeeId: e.id, period: "FIRST_HALF", amount: String(first), status: "PENDING", scheduledDate: "2026-07-15T00:00:00.000Z", paidAt: null },
      { id: `disb-${e.id}-2`, branchId: e.branchId, employeeId: e.id, period: "SECOND_HALF", amount: String(second), status: "PENDING", scheduledDate: "2026-07-31T00:00:00.000Z", paidAt: null },
    );
  }
}
seedDisbursements();

function serializeDisbursement(d: MockDisbursement) {
  const emp = employees.find((e) => e.id === d.employeeId);
  return {
    ...d,
    employee: { id: d.employeeId, fullName: emp?.fullName ?? "—", position: emp?.position ?? "—" },
    payrollRun: { id: "run-2026-07", year: 2026, month: 7, status: "POSTED" },
  };
}

/* ── Sesión Master de preview ───────────────────────────────────────────────── */

const sessionUser = {
  userId: "dev-preview-master",
  username: "preview.master",
  globalRoles: ["MASTER"],
  branchMemberships: branches.map((b) => ({ branchId: b.id, roleCode: "MASTER" })),
  primaryBranchId: branches[0].id,
  roleCode: "MASTER",
  branchIds: branches.map((b) => b.id),
  sessionVersion: 1,
  mustChangePassword: false,
  modules: { master: true, users: true, inventory: true, pricing: true, brain: true },
  activeBranchId: null,
  branches: branches.map((b) => ({ id: b.id, name: b.name, code: b.code, roles: ["MASTER"], capabilities: [], modules: { master: true }, activeCashSession: null })),
  exp: Math.floor(Date.now() / 1000) + 12 * 3600,
};

/* ── Catálogo de muestra (en memoria) ──────────────────────────────────────── */

const mockCategories = [
  { id: "cat-hierro", code: "HIE", name: "Hierro", isActive: true },
  { id: "cat-pintura", code: "PIN", name: "Pinturas", isActive: true },
];
type MockProduct = { id: string; sku: string; name: string; unit: string; categoryId: string; saleUnit?: string; factor?: number; canonical?: boolean };
const mockProducts: MockProduct[] = [
  { id: "p-varilla", sku: "MET-HIE-0001", name: "VARILLA DE HIERRO 3/8 STD", unit: "VARILLA", categoryId: "cat-hierro", saleUnit: "VARILLA", factor: 1, canonical: true },
  { id: "p-quintal", sku: "MET-HIE-0002", name: "HIERRO DE 3/8 STD (QUINTAL)", unit: "UNIDAD", categoryId: "cat-hierro", saleUnit: "QUINTAL", factor: 14, canonical: false },
  { id: "p-pintura", sku: "PIN-ACE-0001", name: "PINTURA DE ACEITE BLANCA", unit: "UN", categoryId: "cat-pintura" },
  { id: "p-plywood", sku: "WOO-PLY-STD-0004", name: 'PLYWOOD DE 3/16"', unit: "UNIDAD", categoryId: "cat-hierro" },
  ...Array.from({ length: 11 }, (_, i) => ({ id: `p-regla-${i}`, sku: `MAD-REG-${i}`, name: `REGLA 1X${2 + Math.floor(i / 4)}X${3 + (i % 4)}`, unit: "UNIDAD", categoryId: "cat-hierro" })),
];
const mockLoadLines: Array<{ id: string; productId: string; newPrice: number | null }> = [
  { id: "pl-1", productId: "p-pintura", newPrice: null },
  { id: "pl-2", productId: "p-plywood", newPrice: null },
];
function mockLoadPreview() {
  const lines = mockLoadLines.map((l) => {
    const p = mockProducts.find((x) => x.id === l.productId)!;
    const changePercent = l.newPrice === null ? null : ((l.newPrice - 100) / 100) * 100;
    return {
      id: l.id, productId: p.id, productSku: p.sku, productName: p.name, branchId: null, branchCode: null,
      costSnapshot: 60, currentPriceSnapshot: 100, priceSourceSnapshot: "STANDARD", newPrice: l.newPrice,
      status: l.newPrice === null ? "SKIPPED" : "PENDING", dbMessage: null, marginCurrent: 40,
      marginNew: l.newPrice ? ((l.newPrice - 60) / l.newPrice) * 100 : null, changePercent,
      classification: l.newPrice === null ? { status: "SKIPPED", reason: "Sin precio nuevo" } : { status: "PENDING", warnings: [], marginNew: null, changePercent },
    };
  });
  return { batch: { id: "pb-1", code: "CP-0001", status: "DRAFT", target: "GENERAL", branchIds: [], reason: "Prueba" }, lines,
    totals: { total: lines.length, toApply: lines.filter((l) => l.newPrice !== null).length, blocked: 0, withWarning: 0, withoutNewPrice: lines.filter((l) => l.newPrice === null).length } };
}
// Asignación manual por sucursal (BranchProductSetting.isAvailable), clave "productId:branchId".
const mockAssignments = new Set<string>();
// Precio general por producto y precio propio por sucursal (clave "productId:branchId").
const mockStandardPrices = new Map<string, number>();
const mockBranchPrices = new Map<string, { price: number; reason: string }>();
// Misma regla que productTextSearchSql: cada palabra en nombre o SKU.
const mockMatches = (p: MockProduct, q: string) => q.trim().toUpperCase().split(/\s+/).filter(Boolean).every((t) => `${p.sku} ${p.name}`.toUpperCase().includes(t));
function mockProductRow(p: MockProduct) {
  return {
    id: p.id, sku: p.sku, name: p.name, unit: p.unit, isActive: true, barcode: null, barcodes: [],
    category: mockCategories.find((c) => c.id === p.categoryId) ?? null,
    inventoryBalances: [], branchProductSettings: [], reorderPolicies: [], totalStock: 0, effectiveCost: null, basePrice: 100,
    allSharedInventoryBalances: [], branchEffectivePricing: [],
    stockConversion: p.saleUnit
      ? { stockGroupId: "g-hierro", stockGroupCode: "HIERRO_3_8_STD", stockGroupName: "Hierro 3/8 STD", baseUnit: "VARILLA", saleUnit: p.saleUnit, conversionFactor: p.factor ?? 1, isCanonical: Boolean(p.canonical) }
      : null,
  };
}

/* ── Servidor ───────────────────────────────────────────────────────────────── */

function send(res: http.ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Set-Cookie": SESSION_COOKIE, ...extraHeaders });
  res.end(JSON.stringify(body));
}
const ok = (res: http.ServerResponse, data: unknown) => send(res, 200, { ok: true, data });

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = (req.method ?? "GET").toUpperCase();

  // Login de preview: setea cookie y manda directo al panel de Planilla.
  if (path === "/api/dev/login") {
    res.writeHead(302, { Location: "/app/master/finance", "Set-Cookie": SESSION_COOKIE });
    res.end();
    return;
  }

  if (path === "/api/auth/session") {
    return ok(res, { authenticated: true, user: sessionUser });
  }
  if (path === "/api/auth/csrf") {
    return ok(res, { csrfToken: "dev-preview-csrf" });
  }
  if (path === "/api/auth/login" && method === "POST") {
    return ok(res, { authenticated: true, user: sessionUser });
  }

  if (path === "/api/branches") {
    return ok(res, branches);
  }

  // ── Catálogo e Inventario (lo mínimo para previsualizar la Lista y su panel de edición) ──
  if (path === "/api/master/branches") return ok(res, branches.map((b) => ({ ...b, isActive: true })));
  if (path === "/api/master/inventory/config/primary-branch") return ok(res, { branchId: branches[0]?.id ?? null });
  if (path === "/api/master/inventory/nav-counts") return ok(res, { activeProducts: mockProducts.length, negativeStock: 0, lowStock: 0, staleTransfers: 0, pendingQuality: 0 });
  if (path === "/api/master/catalog-inventory" && method === "GET") {
    const listed = mockProducts.filter((p) => mockMatches(p, url.searchParams.get("q") ?? ""));
    return ok(res, {
      branches, categories: mockCategories, costScope: "NETWORK", costBranchId: null, costBranchName: null,
      kpis: { activeProducts: mockProducts.length, skusWithoutInventory: 0, criticalStockProducts: 0, zeroStockProducts: 0, totalInventoryValue: 0, productsWithoutCost: 0, productsWithoutPrice: 0, missingPriceCount: 0 },
      products: listed.map(mockProductRow), balances: [], movements: [], transfers: [], reorderAlerts: [], auditLogs: [],
      pagination: { page: 1, limit: 50, total: listed.length, totalPages: 1 },
    });
  }
  if (path === "/api/master/inventory/products" && method === "GET") {
    const found = mockProducts.filter((p) => mockMatches(p, url.searchParams.get("q") ?? ""));
    const limit = Number(url.searchParams.get("limit") ?? 50);
    return ok(res, { rows: found.slice(0, limit).map((p) => ({ id: p.id, sku: p.sku, name: p.name, barcode: null })), nextCursor: null, counts: { ALL: found.length } });
  }
  // ── Carga de precios (un borrador en memoria; PATCH tarda 400 ms como la red real) ──
  if (path === "/api/master/pricing/batches" && method === "GET") {
    return ok(res, { rows: [{ id: "pb-1", code: "CP-0001", status: "DRAFT", target: "GENERAL", branchIds: [], reason: "Prueba", source: "MANUAL", createdByName: "preview.master", appliedByName: null, createdAt: new Date().toISOString(), appliedAt: null, linesTotal: mockLoadLines.length, linesApplied: 0 }], total: 1 });
  }
  if (path === "/api/master/pricing/batches/pb-1" && method === "GET") return ok(res, mockLoadPreview());
  if (path === "/api/master/pricing/batches/pb-1/lines" && method === "PATCH") {
    const body = await readJson(req) as { update?: Array<{ lineId: string; newPrice: number | null }>; add?: Array<{ productId: string }> };
    await new Promise((r) => setTimeout(r, 400));
    for (const u of body.update ?? []) { const l = mockLoadLines.find((x) => x.id === u.lineId); if (l) l.newPrice = u.newPrice; }
    for (const a of body.add ?? []) { const p = mockProducts.find((x) => x.id === a.productId); if (p) mockLoadLines.push({ id: `pl-${p.id}`, productId: p.id, newPrice: null }); }
    return ok(res, mockLoadPreview());
  }
  if (path === "/api/master/catalog-inventory/export" && method === "GET") {
    const buffer = await buildCatalogExportWorkbookFromRows(mockProducts.map((p) => ({
      sku: p.sku, barcode: null, name: p.name, unit: p.unit, isActive: true,
      categoryName: mockCategories.find((c) => c.id === p.categoryId)?.name ?? "",
      standardSalePrice: mockStandardPrices.get(p.id) ?? 100, globalCost: null, stockByBranchId: {},
    })), branches);
    return ok(res, { filename: "catalogo-completo-mock.xlsx", base64: Buffer.from(buffer).toString("base64"), rowCount: mockProducts.length });
  }
  if (path === "/api/catalog/categories" && method === "GET") return ok(res, mockCategories);
  const detailMatch = path.match(/^\/api\/master\/catalog-inventory\/products\/([^/]+)$/);
  if (detailMatch && method === "GET") {
    const p = mockProducts.find((x) => x.id === detailMatch[1]);
    if (!p) return send(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "Producto no encontrado." } });
    const branch = { id: branches[0].id, code: branches[0].code, name: branches[0].name };
    return ok(res, {
      product: {
        id: p.id, sku: p.sku, name: p.name, unit: p.unit, isActive: true, standardSalePrice: String(mockStandardPrices.get(p.id) ?? 100), barcode: null,
        category: mockCategories.find((c) => c.id === p.categoryId) ?? null,
        inventoryBalances: [{ id: "bal-1", quantityOnHand: "28", weightedAverageCost: "590", inventoryValue: "16520", branch }],
        inventoryMovements: [], reorderPolicies: [], brainDecisions: [],
        branchProductSettings: [...mockAssignments].filter((k) => k.startsWith(`${p.id}:`)).map((k) => {
          const b = branches.find((x) => x.id === k.split(":")[1])!;
          return { id: k, isAvailable: true, branchCost: null, branchPrice: null, branch: { id: b.id, code: b.code, name: b.name } };
        }),
      },
      auditLogs: [],
    });
  }
  const assignMatch = path.match(/^\/api\/catalog\/products\/([^/]+)\/branch-settings$/);
  if (assignMatch && method === "PATCH") {
    const body = await readJson(req);
    const key = `${assignMatch[1]}:${String(body.branchId)}`;
    if (body.isAvailable) mockAssignments.add(key); else mockAssignments.delete(key);
    return ok(res, { productId: assignMatch[1], branchId: body.branchId, isAvailable: Boolean(body.isAvailable) });
  }
  if (path === "/api/pricing/suggested" && method === "POST") {
    // Calculadora real (pura) para probar redondeo y avisos sin DB.
    const body = await readJson(req) as Parameters<typeof calculatePricingSuggestion>[0];
    try { return ok(res, { ...calculatePricingSuggestion(body), configExists: true }); }
    catch (e) { return send(res, 400, { ok: false, error: { code: "VALIDATION_ERROR", message: (e as Error).message } }); }
  }
  if (path === "/api/pricing/product-context" && method === "GET") {
    const p = mockProducts.find((x) => x.id === url.searchParams.get("productId"));
    if (!p) return send(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "Producto no encontrado." } });
    return ok(res, {
      productId: p.id, branchId: url.searchParams.get("branchId"), sku: p.sku, name: p.name,
      standardSalePrice: mockStandardPrices.get(p.id) ?? 100, branchPrice: null, effectivePrice: mockStandardPrices.get(p.id) ?? 100, priceSource: "STANDARD",
      branchCost: null, weightedAverageCost: null, effectiveCost: 59, costSource: "NONE", categoryId: p.categoryId, categoryName: "Hierro",
      categoryPolicy: { targetMarginPercent: 30, minProfitAmount: 5, monthlyExpenseAllocation: 0, estimatedMonthlyUnits: 100, isVirtualDefault: true },
    });
  }
  const setPriceMatch = path.match(/^\/api\/master\/pricing\/product\/([^/]+)\/branches\/([^/]+)\/set-price$/);
  if (setPriceMatch && method === "POST") {
    const body = await readJson(req);
    mockBranchPrices.set(`${setPriceMatch[1]}:${setPriceMatch[2]}`, { price: Number(body.price), reason: String(body.reason) });
    return ok(res, { ok: true });
  }
  if (path === "/api/master/pricing/follow-standard" && method === "POST") {
    const body = await readJson(req);
    for (const b of body.branchIds as string[]) mockBranchPrices.delete(`${String(body.productId)}:${b}`);
    return ok(res, { ok: true });
  }
  const pricingMatch = path.match(/^\/api\/master\/pricing\/product\/([^/]+)\/branches$/);
  if (pricingMatch && method === "GET") {
    const standard = mockStandardPrices.get(pricingMatch[1]) ?? 100;
    return ok(res, {
      standardSalePrice: standard,
      branches: branches.map((b) => {
        const own = mockBranchPrices.get(`${pricingMatch[1]}:${b.id}`);
        const price = own?.price ?? standard;
        return { branchId: b.id, branchName: b.name, followsStandard: !own, effectivePrice: price, priceExceptionReason: own?.reason ?? null, priceExceptionAt: own ? new Date().toISOString() : null, effectiveCost: 59, marginPercent: ((price - 59) / price) * 100, hasUnexplainedException: false };
      }),
    });
  }
  if (path === "/api/catalog/products" && method === "GET") {
    return ok(res, mockProducts.filter((p) => mockMatches(p, url.searchParams.get("q") ?? "")));
  }
  const productMatch = path.match(/^\/api\/catalog\/products\/([^/]+)$/);
  if (productMatch && method === "PATCH") {
    const product = mockProducts.find((p) => p.id === productMatch[1]);
    if (!product) return send(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "Producto no encontrado." } });
    const body = await readJson(req);
    if (typeof body.name === "string") product.name = body.name;
    if (typeof body.standardSalePrice === "number") mockStandardPrices.set(product.id, body.standardSalePrice);
    if (typeof body.unit === "string") {
      product.unit = body.unit.toUpperCase();
      if (product.saleUnit) product.saleUnit = product.unit;
    }
    return ok(res, product);
  }

  if (path === "/api/employees" && method === "GET") {
    return ok(res, employees.map(withEstimate));
  }
  if (path === "/api/employees" && method === "POST") {
    const body = await readJson(req);
    const emp: MockEmployee = {
      id: `emp-${randomUUID().slice(0, 8)}`,
      fullName: String(body.fullName ?? "Sin nombre"),
      position: String(body.position ?? "Vendedor"),
      branchId: String(body.branchId ?? branches[0].id),
      monthlySalary: String(body.monthlySalary ?? "0"),
      startDate: `${String(body.startDate ?? new Date().toISOString().slice(0, 10))}T00:00:00.000Z`,
      endDate: null,
      isActive: true,
      applyIrRetention: Boolean(body.applyIrRetention),
      inssSalary: body.inssSalary != null && body.inssSalary !== "" ? String(body.inssSalary) : null,
      nationalId: typeof body.nationalId === "string" && body.nationalId.trim() ? String(body.nationalId).trim() : null,
      lastLiquidationAt: null,
    };
    employees.push(emp);
    return send(res, 201, { ok: true, data: withEstimate(emp) });
  }
  const empMatch = path.match(/^\/api\/employees\/([^/]+)$/);
  if (empMatch) {
    const emp = employees.find((e) => e.id === empMatch[1]);
    if (!emp) return send(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "Empleado no existe" } });
    if (method === "PUT" || method === "PATCH") {
      const body = await readJson(req);
      if (body.fullName !== undefined) emp.fullName = String(body.fullName);
      if (body.position !== undefined) emp.position = String(body.position);
      if (body.branchId !== undefined) emp.branchId = String(body.branchId);
      if (body.monthlySalary !== undefined) emp.monthlySalary = String(body.monthlySalary);
      if (body.startDate !== undefined) emp.startDate = `${String(body.startDate)}T00:00:00.000Z`;
      if (body.applyIrRetention !== undefined) emp.applyIrRetention = Boolean(body.applyIrRetention);
      if (body.inssSalary !== undefined) emp.inssSalary = body.inssSalary != null && body.inssSalary !== "" ? String(body.inssSalary) : null;
      if (body.nationalId !== undefined) emp.nationalId = typeof body.nationalId === "string" && body.nationalId.trim() ? String(body.nationalId).trim() : null;
      return ok(res, withEstimate(emp));
    }
    if (method === "DELETE") {
      emp.isActive = false;
      emp.endDate = new Date().toISOString();
      return ok(res, withEstimate(emp));
    }
    return ok(res, withEstimate(emp));
  }

  // Gastos operativos (tab Gastos de Finanzas): lista, resumen y consolidado.
  if (path === "/api/expenses" && method === "GET") {
    const branchId = url.searchParams.get("branchId") ?? "";
    const wantsSummary = url.searchParams.get("summary") === "true";
    if (branchId === "all" && wantsSummary) return ok(res, allBranchesSummary());
    if (wantsSummary) return ok(res, expenseSummaryFor(branchId));
    return ok(res, allExpenses().filter((e) => !branchId || e.branchId === branchId));
  }
  if (path === "/api/expenses" && method === "POST") {
    const body = await readJson(req);
    const exp: MockExpense = {
      id: `exp-${randomUUID().slice(0, 8)}`,
      branchId: String(body.branchId ?? branches[0].id),
      category: String(body.category ?? "OTHER"),
      description: String(body.description ?? ""),
      amount: String(body.amount ?? "0"),
      isActive: true,
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      effectiveTo: null,
    };
    manualExpenses.push(exp);
    return send(res, 201, { ok: true, data: exp });
  }
  const expMatch = path.match(/^\/api\/expenses\/([^/]+)$/);
  if (expMatch && method === "DELETE") {
    const exp = manualExpenses.find((e) => e.id === expMatch[1]);
    if (exp) exp.isActive = false;
    return ok(res, { deactivated: true });
  }

  // Gastos del local (pantalla Caja del POS) + presupuesto inteligente.
  if (path === "/api/branch/expenses" && method === "GET") {
    const branchId = url.searchParams.get("branchId") ?? "";
    const today = new Date().toISOString().slice(0, 10);
    return ok(
      res,
      manualExpenses.filter((e) => e.isActive && (!branchId || e.branchId === branchId) && e.effectiveFrom.slice(0, 10) === today),
    );
  }
  if (path === "/api/branch/expenses" && method === "POST") {
    const body = await readJson(req);
    const branchId = String(body.branchId ?? branches[0].id);
    const category = String(body.category ?? "OTHER");
    const amountNum = Number(body.amount ?? 0);
    const description = String(body.description ?? "");
    const outlier = checkOutlier(amountNum, paidHistoryStats(branchId, category));
    const now = new Date();
    const exp: MockExpense = {
      id: `exp-${randomUUID().slice(0, 8)}`,
      branchId,
      category,
      description,
      amount: String(amountNum),
      isActive: true,
      effectiveFrom: `${now.toISOString().slice(0, 10)}T00:00:00.000Z`,
      effectiveTo: `${now.toISOString().slice(0, 10)}T00:00:00.000Z`,
    };
    manualExpenses.push(exp);
    paidExpenseHistory.push({ branchId, category, description, amount: amountNum, date: exp.effectiveFrom });
    return send(res, 201, { ok: true, data: { ...exp, warning: outlier.message } });
  }
  if (path === "/api/finance/expense-history") {
    const branchId = url.searchParams.get("branchId") ?? "br-central";
    const cats = [...new Set(paidExpenseHistory.filter((e) => e.branchId === branchId).map((e) => e.category))];
    return ok(res, {
      historyMonths: 6,
      categories: cats.map((c) => paidHistoryStats(branchId, c)).sort((a, b) => b.monthlyAverage - a.monthlyAverage),
    });
  }

  // Cortes quincenales: pendientes consolidados, por corrida, y pago en bloque.
  if (path === "/api/payroll/disbursements" && method === "GET") {
    const runId = url.searchParams.get("payrollRunId");
    const branchId = url.searchParams.get("branchId");
    if (runId) return ok(res, disbursements.map(serializeDisbursement));
    return ok(
      res,
      disbursements
        .filter((d) => d.status === "PENDING" && (!branchId || d.branchId === branchId))
        .map(serializeDisbursement),
    );
  }
  if (path === "/api/payroll/disbursements/cash-status") {
    return ok(res, []);
  }
  if (path === "/api/payroll/disbursements/pay-pending" && method === "POST") {
    const body = await readJson(req);
    const period = body.period === "SECOND_HALF" ? "SECOND_HALF" : "FIRST_HALF";
    const branchId = typeof body.branchId === "string" && body.branchId ? body.branchId : null;
    const targets = disbursements.filter(
      (d) => d.status === "PENDING" && d.period === period && (!branchId || d.branchId === branchId),
    );
    const now = new Date().toISOString();
    for (const d of targets) {
      d.status = "PAID";
      d.paidAt = now;
    }
    return ok(res, {
      paid: targets.length,
      runsProcessed: targets.length > 0 ? 1 : 0,
      perRun: targets.length > 0 ? [{ payrollRunId: "run-2026-07", paid: targets.length }] : [],
      cashSync: [],
    });
  }

  // Cálculo de nómina (tab Calcular Nómina): misma aritmética real, honrando
  // la selección "esto sí, esto no" (includeEmployeeIds / skipLoanEmployeeIds).
  // Harry tiene un préstamo demo con cuota mensual de C$500.
  if (path === "/api/payroll/calculate" && method === "POST") {
    const body = await readJson(req);
    const include =
      Array.isArray(body.includeEmployeeIds) && body.includeEmployeeIds.length > 0
        ? new Set(body.includeEmployeeIds as string[])
        : null;
    const skipLoans = new Set(Array.isArray(body.skipLoanEmployeeIds) ? (body.skipLoanEmployeeIds as string[]) : []);
    const LOAN_MONTHLY: Record<string, number> = { "emp-harry": 500 };
    const rates = currentRates();
    const at = new Date();
    let totalGross = 0, totalDeductions = 0, totalNet = 0, totalEmployerCost = 0;
    const lines = employees
      .filter((e) => e.isActive && (!include || include.has(e.id)))
      .map((e) => {
        const salary = Number(e.monthlySalary);
        const b = computePayrollLineBreakdown({
          monthlySalary: salary,
          grossSalary: salary,
          daysWorked: 30,
          totalDays: 30,
          rates: { ...rates, aguinaldoMode: "ACCRUE_MONTHLY", vacacionesMode: "ACCRUE_MONTHLY", indemnizacionMode: "ACCRUE_MONTHLY" },
          indemnizacionRate: indemnizacionAccrualRate(monthsOfService(e.startDate, at)),
          applyIrRetention: e.applyIrRetention,
          inssMonthlySalary: e.inssSalary != null ? Number(e.inssSalary) : undefined,
          loanDeductions: skipLoans.has(e.id) ? 0 : LOAN_MONTHLY[e.id] ?? 0,
          absenceDays: unjustifiedDays(e.id, at.getFullYear(), at.getMonth() + 1),
        });
        totalGross = round2(totalGross + b.grossSalary);
        totalDeductions = round2(totalDeductions + b.totalDeductions);
        totalNet = round2(totalNet + b.netPay);
        totalEmployerCost = round2(totalEmployerCost + b.employerCost);
        return {
          employeeId: e.id,
          fullName: e.fullName,
          position: e.position,
          branchId: e.branchId,
          monthlySalary: salary,
          daysWorked: 30,
          totalDays: 30,
          proratedSalary: b.grossSalary,
          isFullMonth: true,
          grossSalary: b.grossSalary,
          inssLaboral: b.inssLaboral,
          ir: b.ir,
          inssPatronal: b.inssPatronal,
          inatec: b.inatec,
          provisions: b.provisions,
          absenceDays: b.absenceDays,
          absenceDeduction: b.absenceDeduction,
          loanDeductions: b.loanDeductions,
          otherDeductions: b.otherDeductions,
          netPay: b.netPay,
          employerCost: b.employerCost,
        };
      });
    return ok(res, {
      payrollRunId: "run-preview",
      payrollRunStatus: "DRAFT",
      totalPayroll: totalGross,
      totalGross,
      totalDeductions,
      totalNet,
      totalEmployerCost,
      employeeCount: lines.length,
      rates,
      employees: lines,
    });
  }

  // Centro de Comando (pantalla principal de Master): payload mínimo en ceros
  // para que la página renderice (y se vea el recordatorio de pago 15/30).
  if (path === "/api/master/command-center") {
    return ok(res, {
      generatedAt: new Date().toISOString(),
      totals: {
        salesToday: 0, openSessions: 0, pendingReviewSessions: 0, reconcilingSessions: 0,
        closuresCompletedToday: 0, boxesActive: 0, boxesTotal: 0, usersOnline: 1, usersIdle: 0,
        usersOffline: 0, paidSalesCount: 0, pendingPaymentTotal: 0, pendingPaymentCount: 0,
        openingCashTotal: 0, cashTenderNetTotal: 0, cashMovementsNet: 0, cashExpensesTotal: 0,
        cashOutflowsTotal: 0, expectedCashOnHand: 0, cashNetWithoutOpening: 0,
        cardTenderTotal: 0, transferTenderTotal: 0, otherTenderTotal: 0,
      },
      attention: {
        pendingApprovals: 0, criticalBrainDecisions: 0, openSecurityAlerts: 0,
        daysPendingApproval: 0, staleOpenDays: 0, productsMissingPrice: 0, pendingDispatchTotal: 0,
      },
      users: { summary: { online: 1, idle: 0, offline: 0, openCashSessions: 0 }, list: [] },
      byBranch: [],
      cashClosures: { pending: [], completedToday: [], history: [] },
    });
  }

  // Pase de asistencia (POS, antes de abrir caja): estado + roster + toma.
  if (path === "/api/payroll/attendance/roll-call" && method === "GET") {
    const branchId = url.searchParams.get("branchId") ?? "";
    const date = `${url.searchParams.get("date")}T00:00:00.000Z`;
    const roster = employees
      .filter((e) => e.isActive && e.branchId === branchId)
      .map((e) => ({ id: e.id, fullName: e.fullName, position: e.position }));
    const rc = rollCalls.find((r) => r.branchId === branchId && r.date === date);
    const marks = absences
      .filter((a) => a.date === date && roster.some((e) => e.id === a.employeeId))
      .map((a) => ({ employeeId: a.employeeId, kind: a.kind, notes: a.notes }));
    return ok(res, { taken: Boolean(rc), takenAt: null, reviewStatus: rc?.reviewStatus ?? null, presentCount: rc?.presentCount ?? null, absentCount: rc?.absentCount ?? null, roster, marks });
  }
  if (path === "/api/payroll/attendance/roll-call" && method === "POST") {
    const body = await readJson(req);
    const branchId = String(body.branchId ?? "");
    const date = `${String(body.date)}T00:00:00.000Z`;
    const entries = Array.isArray(body.entries) ? (body.entries as Array<{ employeeId: string; status: string; notes?: string }>) : [];
    const takenAt = new Date().toISOString();
    let present = 0;
    let absent = 0;
    for (const entry of entries) {
      const idx = absences.findIndex((a) => a.employeeId === entry.employeeId && a.date === date);
      if (attended(entry.status)) {
        present++;
        if (idx >= 0) absences.splice(idx, 1);
      } else {
        absent++;
        if (idx >= 0) {
          absences[idx].kind = entry.status;
          absences[idx].notes = entry.notes ?? null;
        } else {
          absences.push({ id: `abs-${randomUUID().slice(0, 8)}`, employeeId: entry.employeeId, date, kind: entry.status, notes: entry.notes ?? null });
        }
      }
    }
    // Re-tomar el pase (corrección) vuelve a dejarlo PENDIENTE: Master debe revisar de nuevo.
    let rc = rollCalls.find((r) => r.branchId === branchId && r.date === date);
    if (!rc) {
      rc = { id: `rc-${randomUUID().slice(0, 8)}`, branchId, date, presentCount: present, absentCount: absent, reviewStatus: "PENDING", reviewedByUserId: null, reviewedAt: null };
      rollCalls.push(rc);
    } else {
      rc.presentCount = present;
      rc.absentCount = absent;
      rc.reviewStatus = "PENDING";
      rc.reviewedByUserId = null;
      rc.reviewedAt = null;
    }
    for (const entry of entries) {
      const markIdx = attendanceMarks.findIndex((m) => m.rollCallId === rc!.id && m.employeeId === entry.employeeId);
      const mark: MockAttendanceMark = {
        id: markIdx >= 0 ? attendanceMarks[markIdx].id : `mark-${randomUUID().slice(0, 8)}`,
        rollCallId: rc.id,
        employeeId: entry.employeeId,
        status: entry.status,
        arrivalAt: attended(entry.status) ? takenAt : null,
        notes: entry.notes ?? null,
      };
      if (markIdx >= 0) attendanceMarks[markIdx] = mark;
      else attendanceMarks.push(mark);
    }
    return ok(res, { presentCount: present, absentCount: absent });
  }

  // Pases pendientes de confirmar por Master (anti "buddy punching").
  if (path === "/api/payroll/attendance/roll-call/pending" && method === "GET") {
    const branchId = url.searchParams.get("branchId");
    const list = rollCalls
      .filter((r) => r.reviewStatus === "PENDING" && (!branchId || r.branchId === branchId) && attendanceMarks.some((m) => m.rollCallId === r.id))
      .map((r) => ({
        id: r.id,
        date: r.date,
        presentCount: r.presentCount,
        absentCount: r.absentCount,
        branch: branches.find((b) => b.id === r.branchId) ?? { id: r.branchId, code: "?", name: "?" },
        marks: attendanceMarks
          .filter((m) => m.rollCallId === r.id)
          .map((m) => {
            const emp = employees.find((e) => e.id === m.employeeId);
            return { employeeId: m.employeeId, status: m.status, arrivalAt: m.arrivalAt, notes: m.notes, employee: { id: m.employeeId, fullName: emp?.fullName ?? "—", position: emp?.position ?? "—" } };
          }),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
    return ok(res, list);
  }
  const confirmMatch = path.match(/^\/api\/payroll\/attendance\/roll-call\/([^/]+)\/confirm$/);
  if (confirmMatch && method === "POST") {
    const rc = rollCalls.find((r) => r.id === confirmMatch[1]);
    if (!rc) return send(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "Pase no existe" } });
    const body = await readJson(req);
    const corrections = Array.isArray(body.corrections) ? (body.corrections as Array<{ employeeId: string; status: string; notes?: string }>) : [];
    for (const c of corrections) {
      const markIdx = attendanceMarks.findIndex((m) => m.rollCallId === rc.id && m.employeeId === c.employeeId);
      if (markIdx < 0) continue;
      attendanceMarks[markIdx].status = c.status;
      attendanceMarks[markIdx].notes = c.notes ?? null;
      attendanceMarks[markIdx].arrivalAt = attended(c.status) ? new Date().toISOString() : null;
      const absIdx = absences.findIndex((a) => a.employeeId === c.employeeId && a.date === rc.date);
      if (attended(c.status)) {
        if (absIdx >= 0) absences.splice(absIdx, 1);
      } else if (absIdx >= 0) {
        absences[absIdx].kind = c.status;
        absences[absIdx].notes = c.notes ?? null;
      } else {
        absences.push({ id: `abs-${randomUUID().slice(0, 8)}`, employeeId: c.employeeId, date: rc.date, kind: c.status, notes: c.notes ?? null });
      }
    }
    const finalMarks = attendanceMarks.filter((m) => m.rollCallId === rc.id);
    rc.presentCount = finalMarks.filter((m) => attended(m.status)).length;
    rc.absentCount = finalMarks.length - rc.presentCount;
    rc.reviewStatus = "CONFIRMED";
    rc.reviewedByUserId = sessionUser.userId;
    rc.reviewedAt = new Date().toISOString();
    return ok(res, rc);
  }

  // Calendario de asistencia del mes por sucursal.
  if (path === "/api/payroll/attendance/calendar" && method === "GET") {
    const branchId = url.searchParams.get("branchId") ?? "";
    const year = Number(url.searchParams.get("year"));
    const month = Number(url.searchParams.get("month"));
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const rollCallIds = new Set(rollCalls.filter((r) => r.branchId === branchId && r.date.startsWith(prefix)).map((r) => r.id));
    const marksList = attendanceMarks
      .filter((m) => rollCallIds.has(m.rollCallId))
      .map((m) => {
        const rc = rollCalls.find((r) => r.id === m.rollCallId)!;
        const emp = employees.find((e) => e.id === m.employeeId);
        return {
          date: rc.date.slice(0, 10),
          employeeId: m.employeeId,
          employeeName: emp?.fullName ?? "—",
          position: emp?.position ?? "—",
          status: m.status,
          arrivalAt: m.arrivalAt,
          notes: m.notes,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    return ok(res, { branchId, year, month, marks: marksList });
  }

  // Ledger de vacaciones: historial por empleado + registro de días gozados/pagados.
  if (path === "/api/payroll/vacation-entries" && method === "GET") {
    const employeeId = url.searchParams.get("employeeId") ?? "";
    const entries = vacationEntries.filter((v) => v.employeeId === employeeId).sort((a, b) => b.date.localeCompare(a.date));
    return ok(res, { employeeId, entries });
  }
  if (path === "/api/payroll/vacation-entries" && method === "POST") {
    const body = await readJson(req);
    const entry: MockVacationEntry = {
      id: `vac-${randomUUID().slice(0, 8)}`,
      employeeId: String(body.employeeId ?? ""),
      date: `${String(body.date)}T00:00:00.000Z`,
      days: Number(body.days ?? 0),
      kind: String(body.kind ?? "GOZADAS"),
      notes: body.notes ? String(body.notes) : null,
    };
    vacationEntries.push(entry);
    return send(res, 201, { ok: true, data: entry });
  }
  const vacMatch = path.match(/^\/api\/payroll\/vacation-entries\/([^/]+)$/);
  if (vacMatch && method === "DELETE") {
    const idx = vacationEntries.findIndex((v) => v.id === vacMatch[1]);
    if (idx >= 0) vacationEntries.splice(idx, 1);
    return ok(res, { deleted: true });
  }

  // Liquidación: ROLLOVER (liquidación y recontratación inmediata — sigue
  // activo, resetea antigüedad) o TERMINATION (baja definitiva, requiere causal).
  if (path === "/api/payroll/settlements" && method === "GET") {
    const employeeId = url.searchParams.get("employeeId") ?? "";
    const list = settlements.filter((s) => s.employeeId === employeeId).sort((a, b) => b.date.localeCompare(a.date));
    return ok(res, { employeeId, settlements: list });
  }
  if (path === "/api/payroll/settlements" && method === "POST") {
    const body = await readJson(req);
    const employeeId = String(body.employeeId ?? "");
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return send(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "Empleado no existe" } });
    if (!emp.isActive) return send(res, 400, { ok: false, error: { code: "VALIDATION_ERROR", message: "El trabajador ya esta inactivo" } });
    const kind = body.kind === "TERMINATION" ? "TERMINATION" : "ROLLOVER";
    const causal = kind === "TERMINATION" ? String(body.causal ?? "DESPIDO_SIN_CAUSA") : null;

    const at = new Date();
    const anchor = emp.lastLiquidationAt ?? emp.startDate;
    const salary = Number(emp.monthlySalary);
    const aguinaldo = aguinaldoAccrued(salary, anchor, at);
    const daysAccrued = vacationDaysAccrued(anchor, at);
    const daysTaken = vacationDaysTaken(emp.id);
    const vacationDaysBalance = Math.max(0, round2(daysAccrued - daysTaken));
    const vacationValue = vacationPayout(vacationDaysBalance, salary);
    const paysIndemnizacion = kind === "ROLLOVER" ? true : (CAUSAL_PAYS_INDEMNIZACION[causal ?? ""] ?? false);
    const indemnizacion = paysIndemnizacion ? indemnizacionPayout(salary, anchor, at) : 0;
    const loanOutstanding = round2(LOAN_OUTSTANDING[emp.id] ?? 0);
    const totalPaid = Math.max(0, round2(aguinaldo + vacationValue + indemnizacion - loanOutstanding));

    if (vacationDaysBalance > 0) {
      vacationEntries.push({
        id: `vac-${randomUUID().slice(0, 8)}`,
        employeeId: emp.id,
        date: at.toISOString(),
        days: vacationDaysBalance,
        kind: "PAGADAS",
        notes: kind === "ROLLOVER" ? "Liquidación y recontratación inmediata" : "Liquidación por baja",
      });
    }
    LOAN_OUTSTANDING[emp.id] = 0;

    const settlement: MockSettlement = {
      id: `settle-${randomUUID().slice(0, 8)}`,
      employeeId: emp.id,
      kind,
      causal,
      date: at.toISOString(),
      aguinaldoPaid: aguinaldo,
      vacationDaysPaid: vacationDaysBalance,
      vacationValuePaid: vacationValue,
      indemnizacionPaid: indemnizacion,
      loanDeduction: loanOutstanding,
      totalPaid,
      notes: typeof body.notes === "string" ? body.notes : null,
    };
    settlements.push(settlement);

    if (kind === "ROLLOVER") {
      emp.lastLiquidationAt = at.toISOString();
    } else {
      emp.isActive = false;
      emp.endDate = at.toISOString();
    }

    return send(res, 201, { ok: true, data: settlement });
  }

  // Asistencia: faltas del mes (las injustificadas descuentan al calcular).
  if (path === "/api/payroll/absences" && method === "GET") {
    const year = Number(url.searchParams.get("year"));
    const month = Number(url.searchParams.get("month"));
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const list = absences
      .filter((a) => a.date.startsWith(prefix))
      .map((a) => {
        const emp = employees.find((e) => e.id === a.employeeId);
        return {
          ...a,
          employee: { id: a.employeeId, fullName: emp?.fullName ?? "—", position: emp?.position ?? "—", branchId: emp?.branchId ?? "", monthlySalary: emp?.monthlySalary ?? "0" },
        };
      })
      .sort((x, y) => y.date.localeCompare(x.date));
    return ok(res, { year, month, absences: list });
  }
  if (path === "/api/payroll/absences" && method === "POST") {
    const body = await readJson(req);
    const employeeId = String(body.employeeId ?? "");
    const date = `${String(body.date)}T00:00:00.000Z`;
    const existing = absences.find((a) => a.employeeId === employeeId && a.date === date);
    if (existing) {
      existing.kind = String(body.kind ?? "UNJUSTIFIED");
      existing.notes = body.notes ? String(body.notes) : null;
      return send(res, 201, { ok: true, data: existing });
    }
    const absence: MockAbsence = { id: `abs-${randomUUID().slice(0, 8)}`, employeeId, date, kind: String(body.kind ?? "UNJUSTIFIED"), notes: body.notes ? String(body.notes) : null };
    absences.push(absence);
    return send(res, 201, { ok: true, data: absence });
  }
  const absMatch = path.match(/^\/api\/payroll\/absences\/([^/]+)$/);
  if (absMatch && method === "DELETE") {
    const idx = absences.findIndex((a) => a.id === absMatch[1]);
    if (idx >= 0) absences.splice(idx, 1);
    return ok(res, { deleted: true });
  }

  // Pago mensual de las facturas del patrón (INSS/INATEC): estado contable.
  if (path === "/api/payroll/contribution-payments" && method === "GET") {
    const year = Number(url.searchParams.get("year"));
    const month = Number(url.searchParams.get("month"));
    return ok(res, { year, month, payments: contributionPayments.filter((p) => p.year === year && p.month === month) });
  }
  if (path === "/api/payroll/contribution-payments" && method === "POST") {
    const body = await readJson(req);
    const year = Number(body.year);
    const month = Number(body.month);
    const kind = String(body.kind);
    const existing = contributionPayments.find((p) => p.year === year && p.month === month && p.kind === kind);
    const paidAt = new Date().toISOString();
    if (existing) {
      existing.amount = String(body.amount);
      existing.paidAt = paidAt;
      return ok(res, existing);
    }
    const payment = { id: `contrib-${randomUUID().slice(0, 8)}`, year, month, kind, amount: String(body.amount), paidAt };
    contributionPayments.push(payment);
    return ok(res, payment);
  }

  if (path === "/api/payroll/rates") {
    if (method === "PATCH") {
      const body = await readJson(req);
      if (body.inssRegime === "INTEGRAL" || body.inssRegime === "IVM_RP") config.inssRegime = body.inssRegime;
      for (const key of ["aguinaldoMode", "vacacionesMode", "indemnizacionMode"] as const) {
        if (body[key] === "ACCRUE_MONTHLY" || body[key] === "ON_PAYMENT") config[key] = body[key];
      }
      if (typeof body.salarioMinimoSectorial === "number" && body.salarioMinimoSectorial >= 0) {
        config.salarioMinimoSectorial = body.salarioMinimoSectorial;
      }
    }
    const rates = currentRates();
    return ok(res, { rates, inss: resolveInssRates(rates.inssRegime, rates.activeEmployeeCount), irTableAnnual: IR_TABLE_ANNUAL });
  }

  // ── Entrada de inventario (lo mínimo para llegar a confirmar) ──
  if (path === "/api/inventory/intake/preview" && method === "POST") {
    const body = (await readJson(req)) as { branchIds: string[]; lines: Array<{ productId: string }> };
    const cells = body.lines.flatMap((line) => body.branchIds.map((branchId) => ({ productId: line.productId, branchId, status: "OK", messages: [], currentEffectiveCost: 100 })));
    return ok(res, { cells, totals: {}, lineMessages: {} });
  }
  if (path === "/api/inventory/multi-branch-intake" && method === "GET") return ok(res, { intakes: [], nextCursor: null });
  if (path === "/api/inventory/multi-branch-intake" && method === "POST") {
    const body = await readJson(req);
    console.log("[mock] entrada con motivo:", body.reason);
    if (!String(body.reason ?? "").trim()) return send(res, 400, { ok: false, error: { code: "VALIDATION_ERROR", message: "Elegí o escribí el motivo de la entrada." } });
    return send(res, 400, { ok: false, error: { code: "VALIDATION_ERROR", message: "Mock: entrada recibida, no se simula el guardado." } });
  }

  // ── Madera ──
  if (path === "/api/timber/trips" && method === "GET") {
    const search = (url.searchParams.get("search") ?? "").toLowerCase();
    const items = mockTrips.filter((t) => t.status !== "CANCELLED" && (t.tripCode.toLowerCase().includes(search) || (t.body.supplierName ?? "").toLowerCase().includes(search)));
    return ok(res, { items: items.map((t) => mockTripDetail(t)).reverse(), total: items.length, nextTripCode: mockNextTripCode() });
  }
  if (path === "/api/timber/trips" && method === "POST") {
    const body = await readJson(req);
    const trip: MockTrip = { id: `trip-${randomUUID().slice(0, 8)}`, tripCode: `BOR-${randomUUID().slice(0, 8).toUpperCase()}`, status: "DRAFT", destinationBranchId: String(body.destinationBranchId), createdAt: new Date().toISOString(), body: { lines: [] } };
    mockTrips.push(trip);
    return ok(res, { trip: mockTripDetail(trip) });
  }
  const tripMatch = path.match(/^\/api\/timber\/trips\/([^/]+)(\/injection-preview)?$/);
  const mockTrip = tripMatch ? mockTrips.find((t) => t.id === tripMatch[1]) : undefined;
  if (tripMatch && !mockTrip) return send(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "Viaje no encontrado." } });
  if (mockTrip && tripMatch?.[2]) return ok(res, mockTripPreview(mockTrip));
  if (mockTrip && method === "GET") return ok(res, mockTripDetail(mockTrip));
  if (mockTrip && method === "PUT") {
    mockTrip.body = await readJson(req);
    return ok(res, { trip: mockTripDetail(mockTrip) });
  }
  if (mockTrip && method === "PATCH") {
    const body = await readJson(req);
    if (body.action === "cancel") mockTrip.status = "CANCELLED";
    if (body.action === "confirm") {
      mockTrip.tripCode = mockNextTripCode();
      mockTrip.status = "TRANSFERRED";
    }
    return ok(res, mockTripDetail(mockTrip));
  }
  if (path === "/api/timber" && method === "GET") {
    const tokens = (url.searchParams.get("search") ?? "").toUpperCase().split(/\s+/).filter(Boolean);
    const type = url.searchParams.get("timberType");
    const items = mockWood.filter((w) => (!type || w.subtype === type) && tokens.every((token) => w.name.includes(token) || w.sku.includes(token) || token === `${w.t}X${w.w}X${MOCK_FEET_BY_VARAS[w.varas]}`));
    return ok(res, {
      total: items.length, page: 1, limit: 15, totalPages: 1,
      items: items.map((w) => {
        const length = MOCK_FEET_BY_VARAS[w.varas];
        return { id: `catalog:${w.id}`, catalogProductId: w.id, isCatalogOnly: true, timberType: w.subtype, woodSubtype: w.subtype, thickness: String(w.t), width: String(w.w), length: String(length), varaLength: w.varas, boardFeet: String((w.t * w.w * length) / 12), baseCost: String(w.cost), sellingPrice: String(w.price), stockOnHand: w.stock, effectiveCost: w.cost, effectivePrice: w.price, priceSource: "BRANCH", costSource: "WAC", product: { id: w.id, name: w.name, sku: w.sku, isActive: true, category: { name: "Madera" } } };
      }),
    });
  }
  if (path === "/api/timber/calculate" && method === "POST") {
    const body = (await readJson(req)) as { thickness: number; width: number; length: number };
    const perPiece = calculateTimber({ thickness: body.thickness, width: body.width, length: body.length });
    const family = body.width >= 10 ? "TABLA" : body.thickness === 1 && body.width >= 6 ? "TABLILLA" : body.thickness === 1 ? "REGLA" : "CUARTON";
    return ok(res, { perPiece, catalogName: `${family} ${body.thickness}X${body.width}X${perPiece.varaLength}`, quantity: 1, pricing: DEFAULT_PRICING });
  }
  if (path === "/api/timber/pricing" && method === "GET") {
    const fixed = mockFixedCostPerFoot.get(url.searchParams.get("branchId") ?? "");
    return ok(res, { ...DEFAULT_PRICING, costPerFoot: fixed ?? DEFAULT_PRICING.costPerFoot, classification: DEFAULT_CLASSIFICATION_CONFIG, targetMarginPercent: 0.4, targetMarginRoundingMultiple: 1, reconciliationTolerancePercent: 0.01, warnBelowTargetMargin: true, blockNegativeMargin: true, isBranchOverride: fixed !== undefined });
  }
  if (path === "/api/timber/branch-cost") {
    const body = method === "POST" ? await readJson(req) : {};
    const costPerFoot = method === "POST" ? Number(body.costPerFoot) : Number(url.searchParams.get("costPerFoot")) || null;
    if (method === "POST") {
      mockFixedCostPerFoot.set(String(body.branchId), costPerFoot as number);
      for (const w of mockWood) w.cost = Math.round(((w.t * w.w * MOCK_FEET_BY_VARAS[w.varas]) / 12) * (costPerFoot as number) * 100) / 100;
    }
    const rows = (url.searchParams.get("branchId") || method === "POST" ? mockWood : []).map((w) => {
      const lengthFeet = MOCK_FEET_BY_VARAS[w.varas];
      const boardFeet = (w.t * w.w * lengthFeet) / 12;
      return { productId: w.id, sku: w.sku, name: w.name, thickness: w.t, width: w.w, lengthFeet, boardFeet, stock: w.stock, totalFeet: w.stock * boardFeet, currentCost: w.cost, newCost: costPerFoot ? Math.round(boardFeet * costPerFoot * 100) / 100 : null, price: w.price };
    });
    const feet = rows.reduce((sum, r) => sum + r.totalFeet, 0);
    const pieces = rows.reduce((sum, r) => sum + r.stock, 0);
    const preview = {
      rows, unreadable: [],
      totals: { pieces, feet, currentValue: rows.reduce((sum, r) => sum + r.stock * r.currentCost, 0), newValue: rows.reduce((sum, r) => sum + r.stock * (r.newCost ?? r.currentCost), 0), saleValue: rows.reduce((sum, r) => sum + r.stock * r.price, 0), belowCost: rows.filter((r) => r.price < (r.newCost ?? r.currentCost)).length },
      byBranch: branches.map((b, i) => ({ branchId: b.id, code: b.code, name: b.name, pieces: i === 0 ? mockWood.reduce((sum, w) => sum + w.stock, 0) : 0, feet: i === 0 ? mockWood.reduce((sum, w) => sum + (w.stock * w.t * w.w * MOCK_FEET_BY_VARAS[w.varas]) / 12, 0) : 0 })),
    };
    return ok(res, method === "POST" ? { applied: rows.length, preview } : preview);
  }

  // Todo lo demás: respuesta vacía inofensiva para que el shell no truene.
  console.log(`[mock] sin handler: ${method} ${path}`);
  return ok(res, null);
});

server.listen(PORT, () => {
  console.log("");
  console.log("  Mock API de Hammer (sin base de datos) escuchando en :" + PORT);
  console.log("  1) En hammer-frontend corré: npm run dev");
  console.log("  2) Abrí en el navegador:  http://localhost:3000/api/dev/login");
  console.log("     (setea la sesión Master de preview y redirige a Finanzas › Planilla)");
  console.log("");
});
