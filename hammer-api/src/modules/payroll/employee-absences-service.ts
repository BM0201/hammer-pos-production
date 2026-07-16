/**
 * Asistencia correlacionada con la nómina.
 *
 * Cada FALTA INJUSTIFICADA descuenta un día de pago (salario diario = mensual
 * ÷ 30) al calcular la nómina del mes; las JUSTIFICADAS (permiso, enfermedad
 * con constancia…) quedan registradas pero no descuentan. Una falta por
 * empleado por día (única por fecha); registrar dos veces el mismo día
 * actualiza el tipo/nota en lugar de duplicar.
 */
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";

export const ABSENCE_KINDS = ["UNJUSTIFIED", "JUSTIFIED"] as const;
export type AbsenceKind = (typeof ABSENCE_KINDS)[number];

/** "YYYY-MM-DD" → fecha pura a medianoche UTC (criterio de fechas puras del repo). */
function absenceDate(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error("INVALID_INPUT: date debe ser YYYY-MM-DD");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (isNaN(date.getTime())) throw new Error("INVALID_INPUT: fecha inválida");
  return date;
}

export async function registerAbsence(
  input: { employeeId: string; date: string; kind: AbsenceKind; notes?: string | null },
  actorUserId?: string,
) {
  if (!ABSENCE_KINDS.includes(input.kind)) {
    throw new Error("INVALID_INPUT: kind debe ser UNJUSTIFIED o JUSTIFIED");
  }
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, branchId: true, fullName: true } });
  if (!employee) throw new Error("EMPLOYEE_NOT_FOUND");
  const date = absenceDate(input.date);
  if (date > new Date()) throw new Error("INVALID_INPUT: no se registran faltas de fechas futuras");

  const absence = await prisma.employeeAbsence.upsert({
    where: { employeeId_date: { employeeId: input.employeeId, date } },
    create: { employeeId: input.employeeId, date, kind: input.kind, notes: input.notes ?? null, createdByUserId: actorUserId ?? null },
    update: { kind: input.kind, notes: input.notes ?? null },
  });

  await logAuditEvent({
    actorUserId: actorUserId ?? undefined,
    branchId: employee.branchId,
    module: "payroll",
    action: "employee_absence.registered",
    entityType: "EmployeeAbsence",
    entityId: absence.id,
    metadataJson: { employeeId: input.employeeId, date: input.date, kind: input.kind },
  });

  return absence;
}

export async function deleteAbsence(id: string, actorUserId?: string) {
  const absence = await prisma.employeeAbsence.findUnique({
    where: { id },
    include: { employee: { select: { branchId: true } } },
  });
  if (!absence) throw new Error("ABSENCE_NOT_FOUND");
  await prisma.employeeAbsence.delete({ where: { id } });

  await logAuditEvent({
    actorUserId: actorUserId ?? undefined,
    branchId: absence.employee.branchId,
    module: "payroll",
    action: "employee_absence.deleted",
    entityType: "EmployeeAbsence",
    entityId: id,
    metadataJson: { employeeId: absence.employeeId, date: absence.date.toISOString().slice(0, 10), kind: absence.kind },
  });

  return { deleted: true };
}

/** Faltas del mes (todas las clases) con datos del empleado, para el tab Asistencia. */
export async function listAbsences(filters: { year: number; month: number; employeeId?: string; branchId?: string }) {
  const start = new Date(Date.UTC(filters.year, filters.month - 1, 1));
  const end = new Date(Date.UTC(filters.year, filters.month, 1));
  return prisma.employeeAbsence.findMany({
    where: {
      date: { gte: start, lt: end },
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      ...(filters.branchId ? { employee: { branchId: filters.branchId } } : {}),
    },
    include: { employee: { select: { id: true, fullName: true, position: true, branchId: true, monthlySalary: true } } },
    orderBy: [{ date: "desc" }],
  });
}

/** Días de falta INJUSTIFICADA por empleado en el mes — alimenta la corrida. */
export async function unjustifiedAbsenceDaysByEmployee(
  employeeIds: string[],
  year: number,
  month: number,
): Promise<Map<string, number>> {
  if (employeeIds.length === 0) return new Map();
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const grouped = await prisma.employeeAbsence.groupBy({
    by: ["employeeId"],
    where: { employeeId: { in: employeeIds }, kind: "UNJUSTIFIED", date: { gte: start, lt: end } },
    _count: { _all: true },
  });
  return new Map(grouped.map((g) => [g.employeeId, g._count._all]));
}
