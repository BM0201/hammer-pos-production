import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { settleEmployeeTx } from "@/modules/payroll/employee-settlement-service";

/**
 * prompt-seguridad-basica.md Fase 1 — settleEmployee leía al empleado fuera
 * de cualquier lock. Employee no tiene "status": TERMINATION pone
 * isActive=false (un CAS plano where:isActive=true ya lo frena), pero
 * ROLLOVER deja isActive=true — ahí el CAS tiene que anclar también
 * lastLiquidationAt al valor leído BAJO EL LOCK, porque es lo único que
 * cambia. Con el lock+relectura ya en su lugar, una llamada repetida en
 * secuencia (el "doble click" real una vez que el primero ya hizo commit)
 * para ROLLOVER no es rechazable por sí sola — es una segunda liquidación
 * legítima con casi cero tiempo transcurrido. Lo que SÍ hay que probar es
 * que el ancla protege contra un escritor que se cuela ENTRE la lectura y
 * el update final (simulado acá haciendo que una de las lecturas que ocurren
 * después del lock mute lastLiquidationAt, como si otra transacción hubiera
 * comiteado justo ahí).
 */

const EMPLOYEE_ID = "emp-1";
const BRANCH_ID = "branch-1";

function createSettlementFakeStore(opts: {
  isActive?: boolean;
  lastLiquidationAt?: Date | null;
  startDate?: Date;
  monthlySalary?: number;
  onFirstLoanRead?: () => void;
} = {}) {
  const employee = {
    id: EMPLOYEE_ID,
    branchId: BRANCH_ID,
    isActive: opts.isActive ?? true,
    lastLiquidationAt: opts.lastLiquidationAt ?? null,
    startDate: opts.startDate ?? new Date("2020-01-01"),
    endDate: null as Date | null,
    monthlySalary: new Prisma.Decimal(opts.monthlySalary ?? 15000),
  };

  const vacationEntries: Array<Record<string, unknown>> = [];
  const settlements: Array<Record<string, unknown> & { id: string }> = [];
  const auditLogs: Array<Record<string, unknown>> = [];
  const loans: Array<{ id: string; outstandingBalance: Prisma.Decimal; status: string }> = [];
  let settlementSeq = 0;
  let loanReadCount = 0;

  const tx = {
    $queryRaw: async () => [],
    employee: {
      findUnique: async () => ({ ...employee }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.id !== employee.id) return { count: 0 };
        if ("isActive" in where && where.isActive !== employee.isActive) return { count: 0 };
        if ("lastLiquidationAt" in where) {
          const expected = where.lastLiquidationAt as Date | null;
          const actual = employee.lastLiquidationAt;
          const same = (expected === null && actual === null) || (expected !== null && actual !== null && expected.getTime() === actual.getTime());
          if (!same) return { count: 0 };
        }
        Object.assign(employee, data);
        return { count: 1 };
      },
    },
    vacationEntry: {
      groupBy: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        vacationEntries.push(data);
        return data;
      },
    },
    employeeLoan: {
      findMany: async () => {
        loanReadCount += 1;
        if (loanReadCount === 1) opts.onFirstLoanRead?.();
        return loans;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const loan = loans.find((l) => l.id === where.id);
        if (loan) Object.assign(loan, data);
        return loan;
      },
    },
    employeeLoanInstallment: {
      create: async ({ data }: { data: Record<string, unknown> }) => data,
    },
    employeeSettlement: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        settlementSeq += 1;
        const row = { id: `settlement-${settlementSeq}`, ...data };
        settlements.push(row);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return data;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { tx: tx as Prisma.TransactionClient, employee, settlements, auditLogs, vacationEntries };
}

test("LA QUE IMPORTA — doble TERMINATION: el segundo falla, sin pagar dos veces", async () => {
  const { tx, employee, settlements } = createSettlementFakeStore();
  const first = await settleEmployeeTx(tx, EMPLOYEE_ID, { kind: "TERMINATION", causal: "DESPIDO_SIN_CAUSA" }, "user-1");
  assert.ok(first.id);
  assert.equal(employee.isActive, false);
  assert.equal(settlements.length, 1);

  await assert.rejects(
    () => settleEmployeeTx(tx, EMPLOYEE_ID, { kind: "TERMINATION", causal: "DESPIDO_SIN_CAUSA" }, "user-1"),
    /ALREADY_PROCESSED/,
  );
  assert.equal(settlements.length, 1, "el segundo intento no debe crear una segunda liquidacion");
});

test("LA QUE IMPORTA — ROLLOVER: un escritor que se cuela entre la lectura y el update final es rechazado por el ancla (lastLiquidationAt)", async () => {
  const { tx, employee, settlements } = createSettlementFakeStore({
    onFirstLoanRead: () => {
      // Simula OTRA transaccion que ya hizo commit de un rollover entre la
      // lectura de este call (lastLiquidationAtAtLock = null) y su propio
      // update final: el valor real en la fila YA NO es el que este call leyo.
      employee.lastLiquidationAt = new Date("2099-01-01T00:00:00Z");
    },
  });

  await assert.rejects(
    () => settleEmployeeTx(tx, EMPLOYEE_ID, { kind: "ROLLOVER" }, "user-1"),
    /ALREADY_PROCESSED/,
  );
  // El empleado sigue activo (ROLLOVER nunca lo desactiva) y el anchor que
  // quedo escrito es el del escritor que "gano" la carrera, no el de este intento.
  assert.equal(employee.isActive, true);
  assert.equal(employee.lastLiquidationAt?.toISOString(), "2099-01-01T00:00:00.000Z");
  assert.equal(settlements.length, 1, "el intento rechazado no debe dejar su liquidacion como valida (se revertiria con la tx real)");
});

test("ROLLOVER normal: el empleado sigue activo y el ancla de antigüedad avanza", async () => {
  const { tx, employee } = createSettlementFakeStore();
  const before = employee.lastLiquidationAt;
  const result = await settleEmployeeTx(tx, EMPLOYEE_ID, { kind: "ROLLOVER" }, "user-1");
  assert.ok(result.id);
  assert.equal(employee.isActive, true);
  assert.notEqual(employee.lastLiquidationAt, before);
});
