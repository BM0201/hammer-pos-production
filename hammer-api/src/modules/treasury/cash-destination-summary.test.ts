import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, PaymentMethod, CashMovementType } from "@prisma/client";
import { getCashSessionDestinationSummaryTx, selectSupersededPostponements } from "@/modules/treasury/cash-monitor";

/**
 * getCashSessionDestinationSummary se parte en dos (mismo patrón que
 * postponeCashDeposit/depositBranchCashDirect): getCashSessionDestinationSummaryTx
 * hace todo el trabajo contra un `tx` — acá se prueba con un tx en memoria,
 * sin base de datos real.
 *
 * ESTE ARCHIVO EXISTE por la captura: "Lo cobrado hoy" mostraba C$890 y
 * "Disponible para mover" mostraba C$0.00 al mismo tiempo, porque
 * availableToMove salía de session.expectedCashAmount (columna que
 * offline-sync nunca actualizaba) en vez de calcularse en vivo. La prueba
 * 2 de abajo es la que blinda exactamente esa regresión.
 *
 * Parte C (prompt-tesoreria-dinero-digital.md) reemplazó collectedThisToday
 * por `money`: physical/inAccount/pendingSettlement/other — los tres
 * estados del dinero, no un mismo casillero repetido cuatro veces. Las
 * pruebas 9-10 son las nuevas de esa parte.
 */

type FakeSession = {
  id: string;
  status: string;
  openingAmount: number;
  expectedCashAmount: number | null;
  countedCashAmount: number | null;
  operationalDayId: string | null;
  physicalCashBox: { branchId: string };
};
type FakeTender = { method: PaymentMethod; amount: number; changeAmount?: number; cashSessionId: string; status: "POSTED"; bankAccountId?: string | null };
type FakeMovement = { type: CashMovementType; amount: number; cashSessionId: string };
type FakeBranch = { id: string; cashFundAmount: number | null };
type FakePostponement = { id: string; cashSessionId: string; branchId: string; amount: number; reason: string | null; postponedUntil: Date; createdAt: Date };
type FakeAccount = { id: string; bankName: string; accountAlias: string; accountNumber: string };

function createFakeTx(opts: {
  sessions: FakeSession[];
  tenders?: FakeTender[];
  movements?: FakeMovement[];
  branches?: FakeBranch[];
  postponements?: FakePostponement[];
  accounts?: FakeAccount[];
  policy?: { branchId: string; maxDaysHolding: number } | null;
}) {
  const sessions = new Map(opts.sessions.map((s) => [s.id, s]));
  const tenders = [...(opts.tenders ?? [])];
  const movements = [...(opts.movements ?? [])];
  const branches = new Map((opts.branches ?? []).map((b) => [b.id, b]));
  const postponements = [...(opts.postponements ?? [])];
  const accounts = new Map((opts.accounts ?? []).map((a) => [a.id, a]));

  const tx = {
    cashSession: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const s = sessions.get(where.id);
        if (!s) throw new Error(`sesion ${where.id} no encontrada`);
        return s;
      },
    },
    branch: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const b = branches.get(where.id);
        if (!b) throw new Error(`sucursal ${where.id} no encontrada`);
        return b;
      },
    },
    paymentTender: {
      // calculateExpectedCashForSessionTx (cash-session/service.ts) llama esto
      // dos veces: una para _sum.amount, otra para _sum.changeAmount.
      aggregate: async ({ where, _sum }: {
        where: { method: PaymentMethod; payment: { cashSessionId: string; status: string } };
        _sum: Record<string, boolean>;
      }) => {
        const matches = tenders.filter(
          (t) => t.method === where.method && t.cashSessionId === where.payment.cashSessionId && t.status === where.payment.status,
        );
        if ("amount" in _sum) {
          return { _sum: { amount: matches.reduce((s, t) => s + t.amount, 0) } };
        }
        return { _sum: { changeAmount: matches.reduce((s, t) => s + (t.changeAmount ?? 0), 0) } };
      },
      // getCashSessionDestinationSummaryTx llama esto para money — SIN
      // filtro de fecha/operationalDay (esa es exactamente la Prueba 3).
      findMany: async ({ where }: { where: { payment: { cashSessionId: string; status: string } } }) =>
        tenders
          .filter((t) => t.cashSessionId === where.payment.cashSessionId && t.status === where.payment.status)
          .map((t) => ({ method: t.method, amount: t.amount, bankAccountId: t.bankAccountId ?? null })),
    },
    cashMovement: {
      findMany: async ({ where }: { where: { cashSessionId: string } }) =>
        movements.filter((m) => m.cashSessionId === where.cashSessionId).map((m) => ({ type: m.type, amount: m.amount })),
    },
    treasuryEntry: {
      findMany: async () => [] as unknown[],
      findFirst: async () => null,
    },
    treasuryAccount: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => accounts.get(id)).filter((a): a is FakeAccount => Boolean(a)),
    },
    cashDepositPostponement: {
      findMany: async ({ where }: { where: { cashSessionId: string } }) =>
        postponements.filter((p) => p.cashSessionId === where.cashSessionId),
      count: async ({ where }: { where: { branchId: string } }) =>
        postponements.filter((p) => p.branchId === where.branchId).length,
    },
    branchDepositPolicy: {
      findUnique: async ({ where }: { where: { branchId: string } }) =>
        opts.policy && opts.policy.branchId === where.branchId ? { maxDaysHolding: opts.policy.maxDaysHolding } : null,
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient };
}

const BRANCH = "branch-1";
const SESSION_ID = "session-1";

test("Prueba 1 — tenders CASH C$890, apertura C$400, fondo C$400 → inDrawer=1290, availableToMove=890", async () => {
  const { tx } = createFakeTx({
    sessions: [{ id: SESSION_ID, status: "OPEN", openingAmount: 400, expectedCashAmount: 0, countedCashAmount: null, operationalDayId: null, physicalCashBox: { branchId: BRANCH } }],
    tenders: [{ method: PaymentMethod.CASH, amount: 890, cashSessionId: SESSION_ID, status: "POSTED" }],
    branches: [{ id: BRANCH, cashFundAmount: 400 }],
  });
  const result = await getCashSessionDestinationSummaryTx(tx, SESSION_ID);
  assert.equal(result.money.physical.inDrawer, 1290, "400 (apertura) + 890 (cobrado en efectivo)");
  assert.equal(result.money.physical.availableToMove, 890, "1290 - 400 (fondo) = 890");
});

test("Prueba 2 (LA DE LA REGRESIÓN) — expectedCashAmount desactualizado en CashSession → availableToMove sale del cálculo en vivo, no de esa columna", async () => {
  const { tx } = createFakeTx({
    sessions: [{ id: SESSION_ID, status: "OPEN", openingAmount: 1000, expectedCashAmount: 0, countedCashAmount: null, operationalDayId: null, physicalCashBox: { branchId: BRANCH } }],
    tenders: [{ method: PaymentMethod.CASH, amount: 500, cashSessionId: SESSION_ID, status: "POSTED" }],
    branches: [{ id: BRANCH, cashFundAmount: 0 }],
  });
  const result = await getCashSessionDestinationSummaryTx(tx, SESSION_ID);
  // La columna stale viaja tal cual — es informativa, para detectar la divergencia.
  assert.equal(result.session.expectedCashAmount, 0);
  // Pero availableToMove NUNCA sale de ahí: 1000 (apertura) + 500 (cobrado) = 1500.
  assert.equal(result.money.physical.availableToMove, 1500, "el cálculo en vivo ignora la columna stale");
  assert.notEqual(result.money.physical.availableToMove, result.session.expectedCashAmount);
});

test("Prueba 3 — un tender con fecha de negocio distinta a hoy (sesión todavía abierta) entra en el total, no se descarta por ninguna ventana de fechas", async () => {
  const { tx } = createFakeTx({
    sessions: [{ id: SESSION_ID, status: "OPEN", openingAmount: 0, expectedCashAmount: 0, countedCashAmount: null, operationalDayId: null, physicalCashBox: { branchId: BRANCH } }],
    // Dos tenders de la misma sesión — sin campo de fecha en la consulta real
    // (ni en este fake): antes, buildWeeklyMoneyBreakdown descartaba en
    // silencio (`if (!day) continue`) todo lo que cruzara la ventana [hoy,
    // hoy+6]. Ahora no hay ninguna ventana que cruzar.
    tenders: [
      { method: PaymentMethod.CASH, amount: 300, cashSessionId: SESSION_ID, status: "POSTED" },
      { method: PaymentMethod.CASH, amount: 590, cashSessionId: SESSION_ID, status: "POSTED" },
    ],
    branches: [{ id: BRANCH, cashFundAmount: 0 }],
  });
  const result = await getCashSessionDestinationSummaryTx(tx, SESSION_ID);
  assert.equal(result.money.physical.inDrawer, 890, "ambos tenders entran, sin importar a qué día operativo pertenecen");
});

test("Prueba 4 — efectivo cobrado 0 y fondo mayor a la apertura → availableToMove es 0, nunca negativo", async () => {
  const { tx } = createFakeTx({
    sessions: [{ id: SESSION_ID, status: "OPEN", openingAmount: 400, expectedCashAmount: 400, countedCashAmount: null, operationalDayId: null, physicalCashBox: { branchId: BRANCH } }],
    tenders: [],
    branches: [{ id: BRANCH, cashFundAmount: 500 }], // fondo > lo que hay en gaveta
  });
  const result = await getCashSessionDestinationSummaryTx(tx, SESSION_ID);
  assert.equal(result.money.physical.inDrawer, 400);
  assert.equal(result.money.physical.availableToMove, 0, "400 - 500 sería -100; se clampea a 0");
});

test("Prueba 5 — tras un HANDOVER de C$500, availableToMove baja exactamente C$500 (no se descuenta dos veces)", async () => {
  const { tx } = createFakeTx({
    sessions: [{ id: SESSION_ID, status: "OPEN", openingAmount: 1000, expectedCashAmount: 1500, countedCashAmount: null, operationalDayId: null, physicalCashBox: { branchId: BRANCH } }],
    tenders: [{ method: PaymentMethod.CASH, amount: 500, cashSessionId: SESSION_ID, status: "POSTED" }],
    movements: [{ type: CashMovementType.BANK_DEPOSIT_OUT, amount: 500, cashSessionId: SESSION_ID }],
    branches: [{ id: BRANCH, cashFundAmount: 0 }],
  });
  const result = await getCashSessionDestinationSummaryTx(tx, SESSION_ID);
  // Sin el movimiento: 1000 + 500 = 1500. Con el movimiento (BANK_DEPOSIT_OUT
  // está en CASH_OUTFLOW_TYPES): 1500 - 500 = 1000. Si se descontara dos
  // veces (acá y de nuevo en el frontend) daría 500.
  assert.equal(result.money.physical.availableToMove, 1000);
});

test("Prueba 6a — una posposición igual al efectivo que queda tras el HANDOVER queda superada (cancelada)", () => {
  const superseded = selectSupersededPostponements(
    [{ id: "p1", amount: 890 }], // única posposición activa de la sesión
    0, // tras el HANDOVER de C$890, no queda nada en gaveta
  );
  assert.deepEqual(superseded.map((p) => p.id), ["p1"]);
});

test("Prueba 6b — cancela las MÁS RECIENTES primero, solo hasta que el total encaje", () => {
  const superseded = selectSupersededPostponements(
    // ya ordenadas por createdAt DESC, como las entrega la consulta real
    [{ id: "p2-mas-reciente", amount: 500 }, { id: "p1-mas-vieja", amount: 500 }],
    700, // queda suficiente para cubrir UNA de las dos (500), no las dos (1000)
  );
  assert.deepEqual(superseded.map((p) => p.id), ["p2-mas-reciente"], "cancela solo la más reciente, la vieja se queda en pie");
});

test("Prueba 6c — si lo que queda alcanza para cubrir todo lo pospuesto, no cancela nada", () => {
  const superseded = selectSupersededPostponements([{ id: "p1", amount: 890 }], 1000);
  assert.deepEqual(superseded, []);
});

test("Prueba 6d — sin posposiciones activas, no hay nada que cancelar", () => {
  const superseded = selectSupersededPostponements([], 0);
  assert.deepEqual(superseded, []);
});

test("Prueba 9 — efectivo + transferencia a dos cuentas + tarjeta: los tres buckets salen separados y byAccount trae las dos cuentas", async () => {
  const { tx } = createFakeTx({
    sessions: [{ id: SESSION_ID, status: "OPEN", openingAmount: 0, expectedCashAmount: 0, countedCashAmount: null, operationalDayId: null, physicalCashBox: { branchId: BRANCH } }],
    tenders: [
      { method: PaymentMethod.CASH, amount: 890, cashSessionId: SESSION_ID, status: "POSTED" },
      { method: PaymentMethod.TRANSFER, amount: 3000, cashSessionId: SESSION_ID, status: "POSTED", bankAccountId: "acct-lafise" },
      { method: PaymentMethod.TRANSFER, amount: 1200, cashSessionId: SESSION_ID, status: "POSTED", bankAccountId: "acct-bac" },
      { method: PaymentMethod.CARD, amount: 1850, cashSessionId: SESSION_ID, status: "POSTED" },
    ],
    branches: [{ id: BRANCH, cashFundAmount: 0 }],
    accounts: [
      { id: "acct-lafise", bankName: "LAFISE", accountAlias: "Cuenta corriente", accountNumber: "0011223344821" },
      { id: "acct-bac", bankName: "BAC", accountAlias: "Cuenta corriente", accountNumber: "5566778801130" },
    ],
  });
  const result = await getCashSessionDestinationSummaryTx(tx, SESSION_ID);

  assert.equal(result.money.physical.inDrawer, 890, "solo el efectivo está en la gaveta");
  assert.equal(result.money.inAccount.total, 4200);
  assert.equal(result.money.pendingSettlement.total, 1850);
  assert.equal(result.money.other.total, 0);

  assert.equal(result.money.inAccount.byAccount.length, 2);
  const lafise = result.money.inAccount.byAccount.find((a) => a.accountId === "acct-lafise")!;
  const bac = result.money.inAccount.byAccount.find((a) => a.accountId === "acct-bac")!;
  assert.equal(lafise.amount, 3000);
  assert.equal(lafise.bankName, "LAFISE");
  assert.equal(lafise.last4, "4821");
  assert.equal(bac.amount, 1200);
  assert.equal(bac.last4, "1130");
});

test("Prueba 10 — availableToMove no incluye nada de inAccount ni pendingSettlement: solo el efectivo físico se puede mover", async () => {
  const { tx } = createFakeTx({
    sessions: [{ id: SESSION_ID, status: "OPEN", openingAmount: 0, expectedCashAmount: 0, countedCashAmount: null, operationalDayId: null, physicalCashBox: { branchId: BRANCH } }],
    tenders: [
      { method: PaymentMethod.CASH, amount: 100, cashSessionId: SESSION_ID, status: "POSTED" },
      { method: PaymentMethod.TRANSFER, amount: 5000, cashSessionId: SESSION_ID, status: "POSTED", bankAccountId: "acct-lafise" },
      { method: PaymentMethod.CARD, amount: 8000, cashSessionId: SESSION_ID, status: "POSTED" },
    ],
    branches: [{ id: BRANCH, cashFundAmount: 0 }],
    accounts: [{ id: "acct-lafise", bankName: "LAFISE", accountAlias: "Cuenta corriente", accountNumber: "4821" }],
  });
  const result = await getCashSessionDestinationSummaryTx(tx, SESSION_ID);
  // Si transferencia u/o tarjeta se colaran en availableToMove, esto daría
  // 13100 (100+5000+8000) o algo mayor a 100 — el bug que esta prueba blinda.
  assert.equal(result.money.physical.availableToMove, 100);
  assert.equal(result.money.inAccount.total, 5000);
  assert.equal(result.money.pendingSettlement.total, 8000);
});
