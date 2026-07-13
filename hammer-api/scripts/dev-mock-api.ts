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
};

const employees: MockEmployee[] = [
  { id: "emp-carolina", fullName: "Carolina Méndez", position: "Vendedor", branchId: "br-central", monthlySalary: "10000", startDate: "2026-01-04T00:00:00.000Z", endDate: null, isActive: true, vacationDaysTaken: "0" },
  { id: "emp-harry", fullName: "Harry López", position: "Supervisor", branchId: "br-central", monthlySalary: "12000", startDate: "2026-01-04T00:00:00.000Z", endDate: null, isActive: true, vacationDaysTaken: "0" },
  { id: "emp-marvin", fullName: "Marvin Ruiz", position: "Bodeguero", branchId: "br-central", monthlySalary: "9500", startDate: "2026-03-15T00:00:00.000Z", endDate: null, isActive: true, vacationDaysTaken: "0" },
  // Demo de tramos Art. 45 — mismo salario que Carolina para ver que cuestan distinto:
  { id: "emp-diana", fullName: "Diana Castillo (4a 5m)", position: "Administrador", branchId: "br-demo", monthlySalary: "10000", startDate: "2022-02-01T00:00:00.000Z", endDate: null, isActive: true, vacationDaysTaken: "20" },
  { id: "emp-ernesto", fullName: "Ernesto Vargas (7a — tope)", position: "Supervisor", branchId: "br-demo", monthlySalary: "10000", startDate: "2019-05-01T00:00:00.000Z", endDate: null, isActive: true, vacationDaysTaken: "45" },
];

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
      return ok(res, withEstimate(emp));
    }
    if (method === "DELETE") {
      emp.isActive = false;
      emp.endDate = new Date().toISOString();
      return ok(res, withEstimate(emp));
    }
    return ok(res, withEstimate(emp));
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
