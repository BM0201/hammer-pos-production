import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, created, validationFail } from "@/lib/api/response";
import { listVacationEntries, registerVacationEntry } from "@/modules/payroll/employee-vacation-service";

/**
 * Ledger de vacaciones: cada entrada es un evento real (gozadas o pagadas en
 * dinero) con fecha — reemplaza el contador suelto de antes.
 */

const registerSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date debe ser YYYY-MM-DD"),
  days: z.coerce.number().positive(),
  kind: z.enum(["GOZADAS", "PAGADAS"]),
  notes: z.string().max(300).optional(),
});

/** GET /api/payroll/vacation-entries?employeeId= — historial del empleado. */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertFinanceAccess(session!);

    const employeeId = new URL(req.url).searchParams.get("employeeId");
    if (!employeeId) return validationFail("employeeId es requerido");

    return ok({ employeeId, entries: await listVacationEntries(employeeId) });
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}

/** POST /api/payroll/vacation-entries — registra días gozados o pagados. */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertFinanceAccess(session!);

    const parsed = registerSchema.safeParse(await req.json());
    if (!parsed.success) return validationFail(parsed.error.issues);

    return created(await registerVacationEntry(parsed.data, session!.userId));
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
