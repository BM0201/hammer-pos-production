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
  indemnizacionAccrualRate,
  indemnizacionAccruedTotal,
  monthsOfService,
  vacationDaysAccrued,
  vacationPayout,
} from "../src/modules/payroll/prestaciones-sociales";
import { checkOutlier, computeCategoryStats } from "../src/modules/finance/expense-intelligence";

const PORT = 4000;
const SESSION_COOKIE = "__Host-hammer_session=dev-preview; Path=/; Secure; HttpOnly; SameSite=Lax";

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
  vacationDaysTaken: string;
  /** Retener IR salarial (varía por trabajador; los 3 reales tributan por su cuenta). */
  applyIrRetention: boolean;
  /** Salario COTIZABLE reportado al INSS (los reales están con 6,519.58). */
  inssSalary: string | null;
};

const employees: MockEmployee[] = [
  { id: "emp-carolina", fullName: "Carolina Méndez", position: "Vendedor", branchId: "br-central", monthlySalary: "10000", startDate: "2026-01-04T00:00:00.000Z", endDate: null, isActive: true, vacationDaysTaken: "0", applyIrRetention: false, inssSalary: "6519.58" },
  { id: "emp-harry", fullName: "Harry López", position: "Supervisor", branchId: "br-central", monthlySalary: "12000", startDate: "2026-01-04T00:00:00.000Z", endDate: null, isActive: true, vacationDaysTaken: "0", applyIrRetention: false, inssSalary: "6519.58" },
  { id: "emp-marvin", fullName: "Marvin Ruiz", position: "Bodeguero", branchId: "br-central", monthlySalary: "9500", startDate: "2026-03-15T00:00:00.000Z", endDate: null, isActive: true, vacationDaysTaken: "0", applyIrRetention: false, inssSalary: "6519.58" },
  // Demo de tramos Art. 45 — mismo salario que Carolina para ver que cuestan distinto.
  // Diana además CON retención de IR, para ver la variación por trabajador:
  { id: "emp-diana", fullName: "Diana Castillo (4a 5m)", position: "Administrador", branchId: "br-demo", monthlySalary: "10000", startDate: "2022-02-01T00:00:00.000Z", endDate: null, isActive: true, vacationDaysTaken: "20", applyIrRetention: true, inssSalary: null },
  { id: "emp-ernesto", fullName: "Ernesto Vargas (7a — tope)", position: "Supervisor", branchId: "br-demo", monthlySalary: "10000", startDate: "2019-05-01T00:00:00.000Z", endDate: null, isActive: true, vacationDaysTaken: "45", applyIrRetention: false, inssSalary: null },
];

/** Pagos de facturas del patrón (INSS/INATEC) marcados en el preview. */
const contributionPayments: Array<{ id: string; year: number; month: number; kind: string; amount: string; paidAt: string }> = [];

/** Faltas registradas (asistencia): las INJUSTIFICADAS descuentan día de pago. */
type MockAbsence = { id: string; employeeId: string; date: string; kind: string; notes: string | null };
const absences: MockAbsence[] = [
  { id: "abs-1", employeeId: "emp-marvin", date: "2026-07-08T00:00:00.000Z", kind: "UNJUSTIFIED", notes: "No avisó" },
];

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
  const months = monthsOfService(emp.startDate, at);
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
  const daysAccrued = vacationDaysAccrued(emp.startDate, at);
  const daysTaken = Number(emp.vacationDaysTaken) || 0;
  const vacationDaysBalance = round2(daysAccrued - daysTaken);

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
      aguinaldoAccrued: aguinaldoAccrued(salary, emp.startDate, at),
      aguinaldoDeadline: aguinaldoPaymentDeadline(at).toISOString().slice(0, 10),
      vacationDaysAccrued: daysAccrued,
      vacationDaysTaken: daysTaken,
      vacationDaysBalance,
      vacationBalanceValue: vacationPayout(Math.max(0, vacationDaysBalance), salary),
      indemnizacionAccrued: indemnizacionAccruedTotal(salary, emp.startDate, at),
      indemnizacionRateActual: indemnizacionRate,
      belowMinimumWage: config.salarioMinimoSectorial > 0 && salary < config.salarioMinimoSectorial,
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
      vacationDaysTaken: "0",
      applyIrRetention: Boolean(body.applyIrRetention),
      inssSalary: body.inssSalary != null && body.inssSalary !== "" ? String(body.inssSalary) : null,
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
