import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  registerManualLoanPaymentTx,
  updateEmployeeLoanTx,
  cancelEmployeeLoanTx,
} from "@/modules/payroll/employee-loans-service";

/**
 * prompt-seguridad-basica.md Fase 1 — registerManualLoanPayment YA corría
 * dentro de su propia transacción, pero sin FOR UPDATE: dos pagos
 * concurrentes leían el MISMO outstandingBalance y cada uno restaba desde
 * ahí (lost update) aunque las dos cuotas quedaran creadas. updateEmployeeLoan
 * y cancelEmployeeLoan no tenían tx ni CAS.
 */

const LOAN_ID = "loan-1";

function createLoanFakeStore(opts: { outstandingBalance?: number; status?: string } = {}) {
  const loan = {
    id: LOAN_ID,
    employeeId: "emp-1",
    branchId: "branch-1",
    principalAmount: new Prisma.Decimal(5000),
    outstandingBalance: new Prisma.Decimal(opts.outstandingBalance ?? 5000),
    installmentAmount: null as Prisma.Decimal | null,
    installmentFrequency: "MONTHLY",
    status: opts.status ?? "ACTIVE",
    notes: null as string | null,
  };

  const installments: Array<Record<string, unknown>> = [];
  const auditLogs: Array<Record<string, unknown>> = [];

  const employee = { id: "emp-1", fullName: "Empleado Test", position: "Operario" };
  const branch = { id: "branch-1", code: "SUC1", name: "Sucursal 1" };

  const tx = {
    $queryRaw: async () => [],
    employeeLoan: {
      findUnique: async () => ({ ...loan }),
      findUniqueOrThrow: async () => ({ ...loan, employee, branch, installments }),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (where.id !== loan.id) throw new Error("loan not found");
        Object.assign(loan, data);
        return { ...loan, employee, branch, installments };
      },
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        if (where.id !== loan.id || where.status !== loan.status) return { count: 0 };
        Object.assign(loan, data);
        return { count: 1 };
      },
    },
    employeeLoanInstallment: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        installments.push(data);
        return data;
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

  return { tx: tx as Prisma.TransactionClient, loan, installments, auditLogs };
}

test("LA QUE IMPORTA — dos pagos manuales 'concurrentes' (mismo tx, llamados en secuencia): ninguno se pierde", async () => {
  const { tx, loan, installments } = createLoanFakeStore({ outstandingBalance: 1000 });

  const first = await registerManualLoanPaymentTx(tx, LOAN_ID, 400, "user-1");
  assert.equal(Number(first.outstandingBalance), 600);

  const second = await registerManualLoanPaymentTx(tx, LOAN_ID, 300, "user-1");
  assert.equal(Number(second.outstandingBalance), 300, "el segundo pago debe restar sobre el balance YA actualizado por el primero, no sobre el original 1000");
  assert.equal(installments.length, 2);
  assert.equal(loan.status, "ACTIVE");
});

test("un pago que salda el prestamo lo marca PAID", async () => {
  const { tx, loan } = createLoanFakeStore({ outstandingBalance: 200 });
  const result = await registerManualLoanPaymentTx(tx, LOAN_ID, 500, "user-1");
  assert.equal(Number(result.outstandingBalance), 0);
  assert.equal(loan.status, "PAID");
});

test("LA QUE IMPORTA — doble updateEmployeeLoan sobre un prestamo ya no-activo: el segundo falla", async () => {
  const { tx, loan } = createLoanFakeStore();
  const first = await updateEmployeeLoanTx(tx, LOAN_ID, { notes: "primera edicion" }, "user-1");
  assert.equal(first.notes, "primera edicion");

  // Simula que, entre el primer y segundo intento, el prestamo paso a PAID
  // (p.ej. un pago manual concurrente lo saldo) -> el segundo edit debe
  // rechazarse, no pisar silenciosamente un prestamo que ya no esta activo.
  loan.status = "PAID";
  await assert.rejects(() => updateEmployeeLoanTx(tx, LOAN_ID, { notes: "segunda edicion" }, "user-1"), /ALREADY_PROCESSED/);
  assert.equal(loan.notes, "primera edicion", "el segundo intento no debe aplicarse");
});

test("LA QUE IMPORTA — doble cancelEmployeeLoan: el segundo falla", async () => {
  const { tx, loan } = createLoanFakeStore();
  const first = await cancelEmployeeLoanTx(tx, LOAN_ID, "user-1");
  assert.equal(first.status, "CANCELLED");
  await assert.rejects(() => cancelEmployeeLoanTx(tx, LOAN_ID, "user-1"), /ALREADY_PROCESSED/);
  assert.equal(loan.status, "CANCELLED");
});
