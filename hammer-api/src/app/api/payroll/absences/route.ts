import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, created, validationFail } from "@/lib/api/response";
import { listAbsences, registerAbsence } from "@/modules/payroll/employee-absences-service";

/**
 * Asistencia correlacionada con la nómina: las faltas INJUSTIFICADAS
 * descuentan un día de pago (salario ÷ 30) al calcular el mes.
 */

const registerSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date debe ser YYYY-MM-DD"),
  kind: z.enum(["UNJUSTIFIED", "JUSTIFIED"]),
  notes: z.string().max(300).optional(),
});

/** GET /api/payroll/absences?year=&month=&employeeId=&branchId= — faltas del mes. */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertFinanceAccess(session!);

    const url = new URL(req.url);
    const year = Number(url.searchParams.get("year"));
    const month = Number(url.searchParams.get("month"));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return validationFail("year y month son requeridos");
    }
    const absences = await listAbsences({
      year,
      month,
      employeeId: url.searchParams.get("employeeId") || undefined,
      branchId: url.searchParams.get("branchId") || undefined,
    });
    return ok({ year, month, absences });
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}

/** POST /api/payroll/absences — registra (o corrige) la falta de un día. */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertFinanceAccess(session!);

    const parsed = registerSchema.safeParse(await req.json());
    if (!parsed.success) return validationFail(parsed.error.issues);

    const absence = await registerAbsence(parsed.data, session!.userId);
    return created(absence);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
