import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, PayrollDisbursementPeriod, PayrollDisbursementStatus } from "@prisma/client";
import { payDisbursementsForPeriodTx } from "@/modules/payroll/payroll-disbursement-service";

/**
 * prompt-seguridad-basica.md Fase 1 — payDisbursementsForPeriod hacia un
 * `update` incondicional por fila dentro del loop: repetir "Pagar todo"
 * (doble click o reintento) pagaba dos veces el mismo desembolso. Ahora cada
 * fila usa su PROPIA updateMany CAS (where status=PENDING); una fila ya
 * pagada por otra ejecución se salta en silencio, sin error — así que
 * repetir la acción completa sigue siendo seguro.
 */

const RUN_ID = "run-1";
const BRANCH_A = "branch-a";
const BRANCH_B = "branch-b";

function createDisbursementFakeStore(opts: { runStatus?: string } = {}) {
  const run = { id: RUN_ID, status: opts.runStatus ?? "POSTED" };

  const disbursements: Array<{
    id: string;
    payrollRunId: string;
    payrollLineId: string;
    employeeId: string;
    branchId: string;
    period: PayrollDisbursementPeriod;
    amount: Prisma.Decimal;
    status: PayrollDisbursementStatus;
    paidAt: Date | null;
    paidByUserId: string | null;
    scheduledDate: Date;
  }> = [
    {
      id: "disb-1",
      payrollRunId: RUN_ID,
      payrollLineId: "line-1",
      employeeId: "emp-1",
      branchId: BRANCH_A,
      period: PayrollDisbursementPeriod.FIRST_HALF,
      amount: new Prisma.Decimal(1000),
      status: PayrollDisbursementStatus.PENDING,
      paidAt: null,
      paidByUserId: null,
      scheduledDate: new Date("2026-07-15"),
    },
    {
      id: "disb-2",
      payrollRunId: RUN_ID,
      payrollLineId: "line-2",
      employeeId: "emp-2",
      branchId: BRANCH_B,
      period: PayrollDisbursementPeriod.FIRST_HALF,
      amount: new Prisma.Decimal(2000),
      status: PayrollDisbursementStatus.PENDING,
      paidAt: null,
      paidByUserId: null,
      scheduledDate: new Date("2026-07-15"),
    },
  ];

  const auditLogs: Array<Record<string, unknown>> = [];

  const tx = {
    payrollRun: {
      findUnique: async () => run,
    },
    payrollDisbursement: {
      findMany: async ({ where }: { where: { payrollRunId: string; period: PayrollDisbursementPeriod; status: PayrollDisbursementStatus } }) =>
        disbursements.filter((d) => d.payrollRunId === where.payrollRunId && d.period === where.period && d.status === where.status),
      updateMany: async ({ where, data }: { where: { id: string; status: PayrollDisbursementStatus }; data: Record<string, unknown> }) => {
        const row = disbursements.find((d) => d.id === where.id);
        if (!row || row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
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

  return { tx: tx as Prisma.TransactionClient, run, disbursements, auditLogs };
}

test("LA QUE IMPORTA — repetir 'Pagar todo' no vuelve a pagar filas ya PAID (cada fila tiene su propio CAS)", async () => {
  const { tx, disbursements, auditLogs } = createDisbursementFakeStore();

  const first = await payDisbursementsForPeriodTx(tx, RUN_ID, "FIRST_HALF", "user-1");
  assert.equal(first.paidIds.length, 2);
  assert.deepEqual(first.affectedBranchIds.sort(), [BRANCH_A, BRANCH_B].sort());
  assert.equal(disbursements.every((d) => d.status === "PAID"), true);
  assert.equal(auditLogs.length, 2);

  // Repetir "Pagar todo": ambas filas ya estan PAID -> nada que pagar, sin error.
  const second = await payDisbursementsForPeriodTx(tx, RUN_ID, "FIRST_HALF", "user-1");
  assert.equal(second.paidIds.length, 0);
  assert.equal(second.affectedBranchIds.length, 0);
  assert.equal(auditLogs.length, 2, "el reintento no debe crear auditoria nueva");
});

test("una fila ya pagada por OTRA ejecucion concurrente se salta en silencio, la otra SI se paga", async () => {
  const { tx, disbursements, auditLogs } = createDisbursementFakeStore();

  // Simula que disb-1 ya fue pagado por otra transaccion concurrente que ya
  // hizo commit (findMany solo trae lo que SIGUE pendiente: disb-2).
  disbursements[0].status = PayrollDisbursementStatus.PAID;
  disbursements[0].paidAt = new Date("2026-07-15T10:00:00Z");
  disbursements[0].paidByUserId = "otro-user";

  const result = await payDisbursementsForPeriodTx(tx, RUN_ID, "FIRST_HALF", "user-1");
  assert.deepEqual(result.paidIds, ["disb-2"]);
  assert.deepEqual(result.affectedBranchIds, [BRANCH_B]);
  assert.equal(auditLogs.length, 1, "solo se audita la fila que esta ejecucion realmente pago");
  assert.equal(disbursements[0].paidByUserId, "otro-user", "la fila ya pagada por otro no se toca");
});

test("corrida no POSTED: rechaza sin tocar ningun desembolso", async () => {
  const { tx, disbursements } = createDisbursementFakeStore({ runStatus: "DRAFT" });
  await assert.rejects(() => payDisbursementsForPeriodTx(tx, RUN_ID, "FIRST_HALF", "user-1"), /INVALID_INPUT/);
  assert.equal(disbursements.every((d) => d.status === "PENDING"), true);
});
