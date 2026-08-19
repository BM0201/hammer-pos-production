import assert from "node:assert/strict";
import test from "node:test";
import { PaymentStatus } from "@prisma/client";
import { paymentValidAsOfPeriodEnd } from "@/modules/finance/service";

/**
 * Auditoría 2026-07-22 (ALTO Finanzas): computeRealPerformance/getFinanceTrend
 * filtraban pagos por el status ACTUAL (payment.status=POSTED,
 * saleOrder.status≠CANCELLED). Una venta de junio cobrada y luego anulada en
 * julio desaparecía de un reporte de junio si ese reporte se volvía a generar
 * DESPUÉS de la anulación — el mes ya "cerrado" cambiaba retroactivamente.
 *
 * Fix: paymentValidAsOfPeriodEnd incluye un pago si sigue POSTED, o si se
 * anuló pero cancelledAt (sellado en cancelSaleOrder) ocurrió DESPUÉS de que
 * el período [start, end) cerrara — igual que la práctica contable estándar
 * de no reabrir un período ya cerrado.
 *
 * Este test simula el escenario numérico exacto con un fake-db que replica
 * la semántica de Prisma (status igual, saleOrder.cancelledAt gte) sobre un
 * pago de C$1,000 hecho el 15 de junio.
 */

type FakePayment = {
  id: string;
  amount: number;
  status: PaymentStatus;
  paidAt: Date;
  branchId: string;
  cancelledAt: Date | null;
};

function matchesWhere(payment: FakePayment, end: Date, branchId: string | null): boolean {
  if (branchId && payment.branchId !== branchId) return false;
  const postedBranch = payment.status === PaymentStatus.POSTED;
  const voidedButValidAtClose = payment.status === PaymentStatus.VOIDED
    && payment.cancelledAt !== null
    && payment.cancelledAt.getTime() >= end.getTime();
  return postedBranch || voidedButValidAtClose;
}

function fakeFindMany(payments: FakePayment[], start: Date, end: Date, branchId: string | null) {
  return payments.filter((p) => p.paidAt >= start && p.paidAt < end && matchesWhere(p, end, branchId));
}

const JUNE_START = new Date("2026-06-01T06:00:00.000Z");
const JUNE_END = new Date("2026-07-01T06:00:00.000Z");

test("paymentValidAsOfPeriodEnd: shape — incluye POSTED, o VOIDED con cancelledAt >= end", () => {
  const where = paymentValidAsOfPeriodEnd(JUNE_END, "branch-1");
  const or = where.OR as Array<Record<string, unknown>>;
  assert.equal(or.length, 2);
  assert.deepEqual(or[0], { status: PaymentStatus.POSTED });
  assert.deepEqual(or[1], { status: PaymentStatus.VOIDED, saleOrder: { cancelledAt: { gte: JUNE_END } } });
});

test("bug documentado: un reporte de junio, regenerado en agosto tras anular en julio, antes perdía la venta", () => {
  // Venta cobrada el 15 de junio; anulada el 10 de julio.
  const payment: FakePayment = {
    id: "p1",
    amount: 1000,
    status: PaymentStatus.VOIDED, // la anulación de julio ya volteó el status
    paidAt: new Date("2026-06-15T18:00:00.000Z"),
    branchId: "branch-1",
    cancelledAt: new Date("2026-07-10T12:00:00.000Z"),
  };

  // Filtro VIEJO (buggy): solo status=POSTED cuenta -> el pago YA NO aparece.
  const buggyIncluded = payment.status === PaymentStatus.POSTED;
  assert.equal(buggyIncluded, false, "con el filtro viejo, el reporte de junio perdía la venta tras la anulación de julio");
});

test("fix: ese mismo pago SIGUE contando para junio, porque la anulacion (julio) fue DESPUES del cierre de junio", () => {
  const payments: FakePayment[] = [{
    id: "p1",
    amount: 1000,
    status: PaymentStatus.VOIDED,
    paidAt: new Date("2026-06-15T18:00:00.000Z"),
    branchId: "branch-1",
    cancelledAt: new Date("2026-07-10T12:00:00.000Z"),
  }];

  const juneReport = fakeFindMany(payments, JUNE_START, JUNE_END, "branch-1");
  assert.equal(juneReport.length, 1);
  assert.equal(juneReport[0]!.amount, 1000, "el reporte de junio no cambia retroactivamente");
});

test("fix: una venta anulada DENTRO del mismo mes que se reporta SI se excluye (la anulacion no es 'futura' respecto al cierre)", () => {
  // Venta de junio, anulada tambien en junio (antes de que el mes cierre).
  const payments: FakePayment[] = [{
    id: "p2",
    amount: 500,
    status: PaymentStatus.VOIDED,
    paidAt: new Date("2026-06-05T12:00:00.000Z"),
    branchId: "branch-1",
    cancelledAt: new Date("2026-06-20T12:00:00.000Z"),
  }];

  const juneReport = fakeFindMany(payments, JUNE_START, JUNE_END, "branch-1");
  assert.equal(juneReport.length, 0, "una anulacion ya ocurrida antes del cierre del mes SI debe excluir la venta de ese mismo mes");
});

test("fix: una venta nunca anulada sigue contando (POSTED de siempre)", () => {
  const payments: FakePayment[] = [{
    id: "p3",
    amount: 750,
    status: PaymentStatus.POSTED,
    paidAt: new Date("2026-06-20T12:00:00.000Z"),
    branchId: "branch-1",
    cancelledAt: null,
  }];

  const juneReport = fakeFindMany(payments, JUNE_START, JUNE_END, "branch-1");
  assert.equal(juneReport.length, 1);
  assert.equal(juneReport[0]!.amount, 750);
});
