import { CashMovementType, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { conceptMatchesCategory } from "@/modules/pricing/expense-kind";

type DbClient = PrismaClient | Prisma.TransactionClient;

function num(value: Prisma.Decimal | number | null | undefined): number {
  return Number(value ?? 0);
}

/**
 * prompt-gastos-semana-quincena.md Fase 4 — "CASH_OUT sin clasificar" (la
 * alerta de Fase 2.4): retiros genéricos de caja que en realidad eran un
 * gasto, o que de verdad no lo son. Dos salidas, ambas desde Master:
 *
 *  - classifyCashOutAsExpense: SÍ es un gasto. Cambia el `type` del
 *    movimiento a EXPENSE_OUT (CASH_OUT y EXPENSE_OUT restan lo MISMO del
 *    efectivo esperado — ver CASH_OUTFLOW_TYPES en expected-cash.ts — así
 *    que el arqueo de esa sesión no se mueve) y liga un OperatingExpense
 *    PAID nuevo vía el FK único existente `cashMovementId`, igual que un
 *    gasto registrado desde el POS.
 *  - dismissCashOutAsNotExpense: NO es un gasto (de verdad era un retiro).
 *    Se marca revisado (reviewedAt/reviewedByUserId/reviewNote, mismo
 *    nombrado que CashSession/OperationalDay) sin tocar type ni monto —
 *    la alerta no debe volver a mostrarlo.
 *
 * Ambas rechazan un movimiento que YA se clasificó o ya se descartó (409),
 * para que nadie lo reclasifique duplicado por error.
 */
export type ClassifyCashOutInput = {
  category: string;
  conceptId?: string | null;
  payee?: string | null;
  receiptNumber?: string | null;
  description?: string | null;
};

async function loadCashOutOrThrow(db: DbClient, cashMovementId: string) {
  const movement = await db.cashMovement.findUnique({
    where: { id: cashMovementId },
    select: {
      id: true, type: true, amount: true, reason: true, createdAt: true, reviewedAt: true,
      cashSessionId: true,
      operatingExpense: { select: { id: true } },
      cashSession: { select: { physicalCashBox: { select: { branchId: true } } } },
    },
  });
  if (!movement) throw new Error("NOT_FOUND: movimiento de caja no encontrado.");
  if (movement.type !== CashMovementType.CASH_OUT) {
    throw new Error("VALIDATION_ERROR: solo se pueden clasificar retiros (CASH_OUT).");
  }
  if (movement.operatingExpense) {
    throw new Error("CONFLICT: este retiro ya se clasificó como gasto.");
  }
  if (movement.reviewedAt) {
    throw new Error("CONFLICT: este retiro ya se marcó como revisado.");
  }
  return movement;
}

export async function classifyCashOutAsExpense(
  cashMovementId: string,
  input: ClassifyCashOutInput,
  actorUserId: string,
  db: PrismaClient = prisma,
) {
  const movement = await loadCashOutOrThrow(db, cashMovementId);
  const branchId = movement.cashSession.physicalCashBox.branchId;

  if (input.conceptId) {
    const concept = await db.expenseConcept.findUnique({ where: { id: input.conceptId }, select: { category: true } });
    if (!concept || !conceptMatchesCategory(concept.category, input.category)) {
      throw new Error("VALIDATION_ERROR: el concepto no corresponde a esa categoría.");
    }
  }

  // Sin recálculo de expectedCashAmount: CASH_OUT y EXPENSE_OUT restan lo
  // MISMO del efectivo esperado (CASH_OUTFLOW_TYPES, expected-cash.ts), así
  // que el snapshot ya guardado de la sesión sigue siendo exacto — cambiar
  // el `type` no cambia ningún monto ni ninguna suma.
  return db.$transaction(async (tx) => {
    await tx.cashMovement.update({ where: { id: movement.id }, data: { type: CashMovementType.EXPENSE_OUT } });
    return tx.operatingExpense.create({
      data: {
        branchId,
        category: input.category as any,
        description: input.description?.trim() || movement.reason,
        amount: new Prisma.Decimal(num(movement.amount)),
        effectiveFrom: movement.createdAt,
        effectiveTo: movement.createdAt,
        createdByUserId: actorUserId,
        conceptId: input.conceptId ?? null,
        payee: input.payee ?? null,
        receiptNumber: input.receiptNumber ?? null,
        kind: "PAID",
        paidAt: movement.createdAt,
        cashMovementId: movement.id,
      },
    });
  });
}

export async function dismissCashOutAsNotExpense(
  cashMovementId: string,
  note: string,
  actorUserId: string,
  db: DbClient = prisma,
) {
  const trimmed = note.trim();
  if (trimmed.length < 3) throw new Error("VALIDATION_ERROR: el motivo debe tener al menos 3 caracteres.");

  await loadCashOutOrThrow(db, cashMovementId);

  return db.cashMovement.update({
    where: { id: cashMovementId },
    data: { reviewedAt: new Date(), reviewedByUserId: actorUserId, reviewNote: trimmed },
  });
}

export type UnclassifiedCashOutRow = {
  id: string;
  amount: number;
  reason: string;
  createdAt: Date;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  createdByName: string | null;
};

/** Para el panel Master de "Clasificar retiros" — los mismos que la alerta de Fase 2.4 cuenta. */
export async function listUnclassifiedCashOuts(
  input: { start: Date; end: Date; branchId: string | null },
  db: DbClient = prisma,
): Promise<UnclassifiedCashOutRow[]> {
  const movements = await db.cashMovement.findMany({
    where: {
      type: CashMovementType.CASH_OUT,
      createdAt: { gte: input.start, lt: input.end },
      reviewedAt: null,
      operatingExpense: { is: null },
      ...(input.branchId ? { cashSession: { physicalCashBox: { branchId: input.branchId } } } : {}),
    },
    select: {
      id: true, amount: true, reason: true, createdAt: true,
      createdBy: { select: { fullName: true } },
      cashSession: { select: { physicalCashBox: { select: { branchId: true, branch: { select: { code: true, name: true } } } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return movements.map((m) => ({
    id: m.id,
    amount: num(m.amount),
    reason: m.reason,
    createdAt: m.createdAt,
    branchId: m.cashSession.physicalCashBox.branchId,
    branchCode: m.cashSession.physicalCashBox.branch?.code ?? null,
    branchName: m.cashSession.physicalCashBox.branch?.name ?? null,
    createdByName: m.createdBy?.fullName ?? null,
  }));
}
