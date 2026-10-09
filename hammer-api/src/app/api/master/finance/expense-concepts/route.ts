import { z } from "zod";
import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { isMaster, hasCapabilityInAnyAssignedBranch } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { EXPENSE_CATEGORIES } from "@/modules/pricing/validators";
import { listExpenseConcepts, createExpenseConcept } from "@/modules/finance/expense-concepts";

const listSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  includeInactive: z.coerce.boolean().optional(),
});

const createSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  name: z.string().trim().min(1),
  sortOrder: z.coerce.number().int().optional(),
});

/** GET /api/master/finance/expense-concepts — lista para el selector (Fase 4) y la pantalla de administración (Fase 3). */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session) && !hasCapabilityInAnyAssignedBranch(session!, CAPABILITIES.FINANCE_VIEW)) {
      return fail("FORBIDDEN", "No tienes permiso para ver finanzas.", 403);
    }

    const url = new URL(request.url);
    const parsed = listSchema.safeParse({
      category: url.searchParams.get("category") ?? undefined,
      includeInactive: url.searchParams.get("includeInactive") ?? undefined,
    });
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    return ok(await listExpenseConcepts(parsed.data));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

/** POST — crear un concepto nuevo. Master o quien administre finanzas. */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session) && !hasCapabilityInAnyAssignedBranch(session!, CAPABILITIES.FINANCE_MANAGE_EXPENSES)) {
      return fail("FORBIDDEN", "No tienes permiso para administrar gastos.", 403);
    }

    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    return ok(await createExpenseConcept(parsed.data));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
