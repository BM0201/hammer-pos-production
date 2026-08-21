import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { created, fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { recordRetainedCashExpenseSchema } from "@/modules/treasury/validators";
import { recordRetainedCashExpense } from "@/modules/treasury/service";
import { prisma } from "@/lib/prisma";

function retainedCashExpenseError(error: unknown) {
  if (!(error instanceof Error)) return null;
  if (error.message === "SAFE_ACCOUNT_REQUIRED") {
    return fail(error.message, "Esta sucursal no tiene una cuenta de caja fuerte (SAFE) configurada. Créala en Tesorería antes de pagar con efectivo retenido.", 409);
  }
  if (error.message === "CASH_EXPENSE_POLICY_REQUIRED") {
    return fail(error.message, "Esta sucursal no tiene un tope de gasto en efectivo retenido configurado. Configúralo antes de pagar con efectivo retenido.", 409);
  }
  return null;
}

/**
 * Gasto pagado con efectivo retenido (prompt-tesoreria-gasto-retenido-y-techo.md
 * T-1) — no la gaveta abierta, la cuenta SAFE de cierres anteriores esperando
 * depósito. Sobre el tope configurado, no mueve dinero: devuelve 202 con la
 * solicitud de aprobación pendiente.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const parsed = recordRetainedCashExpenseSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const result = await recordRetainedCashExpense({ ...parsed.data, actorUserId: session.userId });
    if (result.status === "PENDING_APPROVAL") {
      return fail("APPROVAL_REQUESTED", "El monto supera el tope configurado — se envió a aprobación.", 202, {
        requestId: result.requestId,
        created: result.created,
      });
    }
    return created(result);
  } catch (error) {
    const mapped = retainedCashExpenseError(error);
    if (mapped) return mapped;
    return toHttpErrorResponse(error);
  }
}

/** Lista los gastos pagados con efectivo retenido de una sucursal (R-1: no una tercera pantalla de gastos, solo estos). */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es obligatorio.", 400);

    const entries = await prisma.treasuryEntry.findMany({
      where: { account: { branchId, type: "SAFE" }, entryType: "EXPENSE", expensePaymentId: { not: null } },
      orderBy: { occurredAt: "desc" },
      take: 100,
      select: {
        id: true,
        amount: true,
        occurredAt: true,
        reference: true,
        notes: true,
        expensePaymentId: true,
        counterpartyType: true,
      },
    });
    const expenseIds = entries.map((e) => e.expensePaymentId).filter((id): id is string => id !== null);
    const expenses = await prisma.operatingExpense.findMany({
      where: { id: { in: expenseIds } },
      select: { id: true, category: true, description: true, isActive: true, branchId: true },
    });
    const expenseById = new Map(expenses.map((e) => [e.id, e]));

    const rows = entries
      .map((entry) => {
        const expense = entry.expensePaymentId ? expenseById.get(entry.expensePaymentId) : null;
        if (!expense) return null;
        return {
          treasuryEntryId: entry.id,
          expenseId: expense.id,
          amount: entry.amount.toString(),
          occurredAt: entry.occurredAt,
          receiptReference: entry.reference,
          category: expense.category,
          description: expense.description,
          isActive: expense.isActive,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return ok(rows);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
