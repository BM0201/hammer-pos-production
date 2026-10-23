import { CashMovementType, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { conceptMatchesCategory } from "@/modules/pricing/expense-kind";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * prompt-caja-gastos-pos-cobro.md Commit 3 — "Reclasificar" (solo Master/
 * Owner — ver isMaster() en las rutas). Dos acciones, ambas auditadas con
 * antes/después, escrito DENTRO de la misma transacción (no vía
 * logAuditEvent, que usa el prisma real sin inyección — así queda
 * testeable con fake-db, igual que cash-out-classification.ts):
 *
 *  - reclassifyExpenseCategory: "nunca cambia el monto, la fecha ni el
 *    movimiento de caja. Solo la clasificación" — tal cual el doc, update
 *    acotado a category/conceptId.
 *  - convertExpenseToCashPurchase: "Era una compra de mercadería" —
 *    convierte el gasto en CashPurchase. El doc dice "sin tocar... el
 *    movimiento de caja", pero eso es inconsistente con lograr el efecto
 *    que el propio doc pide ("sale del gasto operativo"): loadCashRows
 *    (expense-ledger.ts) cuenta CUALQUIER CashMovement type=EXPENSE_OUT
 *    en el gasto operativo, con o sin OperatingExpense vinculado (cae a
 *    "Sin clasificar" si no tiene uno, pero SIGUE sumando al total). Para
 *    que de verdad salga del gasto operativo, el movimiento tiene que
 *    pasar a PURCHASE_OUT — se prioriza el resultado nombrado explícito
 *    ("sale del gasto operativo") sobre el detalle de implementación
 *    asumido ("sin tocar el movimiento"). Reportado en el resumen final.
 */

async function loadExpenseOrThrow(db: DbClient, expenseId: string) {
  const expense = await db.operatingExpense.findUnique({ where: { id: expenseId } });
  if (!expense) throw new Error("NOT_FOUND: gasto no encontrado.");
  return expense;
}

export async function reclassifyExpenseCategory(
  expenseId: string,
  input: { category: string; conceptId: string | null },
  actorUserId: string,
  db: PrismaClient = prisma,
) {
  return db.$transaction(async (tx) => {
    const expense = await loadExpenseOrThrow(tx, expenseId);

    if (input.conceptId) {
      const concept = await tx.expenseConcept.findUnique({ where: { id: input.conceptId }, select: { category: true } });
      if (!concept || !conceptMatchesCategory(concept.category, input.category)) {
        throw new Error("VALIDATION_ERROR: el concepto no corresponde a esa categoría.");
      }
    }

    const updated = await tx.operatingExpense.update({
      where: { id: expenseId },
      data: { category: input.category as never, conceptId: input.conceptId },
    });

    await tx.auditLog.create({
      data: {
        actorUserId,
        branchId: expense.branchId,
        module: "finance",
        action: "EXPENSE_RECLASSIFIED",
        entityType: "OperatingExpense",
        entityId: expenseId,
        metadataJson: {
          before: { category: expense.category, conceptId: expense.conceptId },
          after: { category: input.category, conceptId: input.conceptId },
        } as Prisma.InputJsonValue,
      },
    });

    return updated;
  });
}

export async function convertExpenseToCashPurchase(
  expenseId: string,
  input: { supplierName?: string | null; kind: "GOODS" | "FREIGHT" },
  actorUserId: string,
  db: PrismaClient = prisma,
) {
  return db.$transaction(async (tx) => {
    const expense = await loadExpenseOrThrow(tx, expenseId);
    if (!expense.cashMovementId) {
      throw new Error("VALIDATION_ERROR: este gasto no está ligado a un movimiento de caja (no se pagó con efectivo de sucursal) — no se puede convertir en compra.");
    }

    await tx.cashMovement.update({ where: { id: expense.cashMovementId }, data: { type: CashMovementType.PURCHASE_OUT } });
    const purchase = await tx.cashPurchase.create({
      data: {
        branchId: expense.branchId,
        amount: expense.amount,
        description: expense.description,
        supplierName: input.supplierName ?? null,
        kind: input.kind,
        cashMovementId: expense.cashMovementId,
        createdById: actorUserId,
        receiptPhotoUrl: expense.receiptPhotoUrl,
      },
    });
    await tx.operatingExpense.delete({ where: { id: expenseId } });

    await tx.auditLog.create({
      data: {
        actorUserId,
        branchId: expense.branchId,
        module: "finance",
        action: "EXPENSE_CONVERTED_TO_CASH_PURCHASE",
        entityType: "CashPurchase",
        entityId: purchase.id,
        metadataJson: {
          previousExpenseId: expenseId,
          amount: Number(expense.amount),
          description: expense.description,
          category: expense.category,
          kind: input.kind,
          supplierName: input.supplierName ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    return purchase;
  });
}

/** Para el aviso "Revisar N gastos en Otros" — gastos OTHER en el período, con la sugerencia de categoría/concepto (mismas palabras clave del Commit 1). */
export async function listOtherExpensesForReview(input: { start: Date; end: Date; branchId: string | null }, db: PrismaClient = prisma) {
  return db.operatingExpense.findMany({
    where: {
      category: "OTHER",
      kind: "PAID",
      effectiveFrom: { gte: input.start, lt: input.end },
      ...(input.branchId ? { branchId: input.branchId } : {}),
    },
    select: { id: true, amount: true, description: true, effectiveFrom: true, branchId: true, payee: true },
    orderBy: { effectiveFrom: "desc" },
  });
}
