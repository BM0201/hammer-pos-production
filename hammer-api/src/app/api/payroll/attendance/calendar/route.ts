import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, validationFail } from "@/lib/api/response";
import { listAttendanceCalendar } from "@/modules/payroll/employee-absences-service";

/**
 * Calendario de asistencia de una sucursal en un mes: una marca por
 * trabajador por día, para pintar el mes por estado (RRHH › Asistencia).
 */

/** GET ?branchId=&year=&month= — marcas del mes para esa sucursal. */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertFinanceAccess(session!);

    const url = new URL(req.url);
    const branchId = url.searchParams.get("branchId");
    const year = Number(url.searchParams.get("year"));
    const month = Number(url.searchParams.get("month"));
    if (!branchId) return validationFail("branchId es requerido");
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return validationFail("year y month son requeridos");
    }

    return ok({ branchId, year, month, marks: await listAttendanceCalendar(branchId, year, month) });
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
