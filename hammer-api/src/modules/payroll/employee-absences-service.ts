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

/* ── Pase de asistencia diario (desde el POS, antes de abrir caja) ─────────── */

export type RollCallStatus = "PRESENT" | "UNJUSTIFIED" | "JUSTIFIED";
const ROLL_CALL_STATUSES: readonly RollCallStatus[] = ["PRESENT", "UNJUSTIFIED", "JUSTIFIED"];

/**
 * Estado del pase de hoy para una sucursal: si ya se tomó, el personal ACTIVO
 * de la sucursal (con su puesto) y las marcas del día (para corregir).
 */
export async function getRollCall(branchId: string, dateIso: string) {
  const date = absenceDate(dateIso);
  const nextDay = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const [rollCall, roster] = await Promise.all([
    prisma.attendanceRollCall.findUnique({ where: { branchId_date: { branchId, date } } }),
    prisma.employee.findMany({
      where: { branchId, isActive: true },
      select: { id: true, fullName: true, position: true },
      orderBy: { fullName: "asc" },
    }),
  ]);
  const marks = await prisma.employeeAbsence.findMany({
    where: { employeeId: { in: roster.map((e) => e.id) }, date: { gte: date, lt: nextDay } },
    select: { employeeId: true, kind: true, notes: true },
  });
  return {
    taken: Boolean(rollCall),
    takenAt: rollCall?.createdAt.toISOString() ?? null,
    reviewStatus: rollCall?.reviewStatus ?? null,
    presentCount: rollCall?.presentCount ?? null,
    absentCount: rollCall?.absentCount ?? null,
    roster,
    marks: marks.map((m) => ({ employeeId: m.employeeId, kind: m.kind, notes: m.notes })),
  };
}

/**
 * Toma (o corrige) el pase del día: PRESENT borra cualquier falta previa de
 * esa fecha; UNJUSTIFIED/JUSTIFIED registran la falta (upsert). Deja el
 * registro AttendanceRollCall — el modal del POS solo aparece una vez al día.
 */
export async function takeRollCall(
  input: {
    branchId: string;
    date: string;
    entries: Array<{ employeeId: string; status: RollCallStatus; notes?: string | null }>;
  },
  actorUserId?: string,
) {
  const date = absenceDate(input.date);
  if (date > new Date()) throw new Error("INVALID_INPUT: no se pasa asistencia de fechas futuras");
  for (const entry of input.entries) {
    if (!ROLL_CALL_STATUSES.includes(entry.status)) {
      throw new Error("INVALID_INPUT: status debe ser PRESENT, UNJUSTIFIED o JUSTIFIED");
    }
  }
  // Solo personal ACTIVO de ESTA sucursal (nadie marca faltas de otra).
  const roster = await prisma.employee.findMany({
    where: { branchId: input.branchId, isActive: true },
    select: { id: true },
  });
  const rosterIds = new Set(roster.map((e) => e.id));
  const entries = input.entries.filter((e) => rosterIds.has(e.employeeId));

  // Marca esta toma para todos los que confirmen PRESENT (para "hora de
  // llegada" real de cada quien — antes esto no se guardaba en ningún lado).
  const takenAt = new Date();
  let present = 0;
  let absent = 0;
  for (const entry of entries) {
    if (entry.status === "PRESENT") {
      present++;
      await prisma.employeeAbsence.deleteMany({ where: { employeeId: entry.employeeId, date } });
    } else {
      absent++;
      await prisma.employeeAbsence.upsert({
        where: { employeeId_date: { employeeId: entry.employeeId, date } },
        create: { employeeId: entry.employeeId, date, kind: entry.status, notes: entry.notes ?? null, createdByUserId: actorUserId ?? null },
        update: { kind: entry.status, notes: entry.notes ?? null },
      });
    }
  }

  const rollCall = await prisma.attendanceRollCall.upsert({
    where: { branchId_date: { branchId: input.branchId, date } },
    // Re-tomar el pase (corrección) vuelve a dejarlo PENDIENTE: Master debe
    // revisar de nuevo — evita que una corrección del cajero quede sin ojo.
    create: { branchId: input.branchId, date, takenByUserId: actorUserId ?? null, presentCount: present, absentCount: absent, reviewStatus: "PENDING" },
    update: { takenByUserId: actorUserId ?? null, presentCount: present, absentCount: absent, reviewStatus: "PENDING", reviewedByUserId: null, reviewedAt: null },
  });

  for (const entry of entries) {
    await prisma.attendanceMark.upsert({
      where: { rollCallId_employeeId: { rollCallId: rollCall.id, employeeId: entry.employeeId } },
      create: {
        rollCallId: rollCall.id,
        employeeId: entry.employeeId,
        status: entry.status,
        arrivalAt: entry.status === "PRESENT" ? takenAt : null,
        notes: entry.notes ?? null,
      },
      update: {
        status: entry.status,
        arrivalAt: entry.status === "PRESENT" ? takenAt : null,
        notes: entry.notes ?? null,
      },
    });
  }

  await logAuditEvent({
    actorUserId: actorUserId ?? undefined,
    branchId: input.branchId,
    module: "payroll",
    action: "attendance_roll_call.taken",
    entityType: "AttendanceRollCall",
    entityId: rollCall.id,
    metadataJson: { date: input.date, presentCount: present, absentCount: absent },
  });

  return { rollCall, presentCount: present, absentCount: absent };
}

/* ── Confirmación por Master (anti "buddy punching") ───────────────────────── */

export const ROLL_CALL_REVIEW_STATUSES = ["PENDING", "CONFIRMED"] as const;
export type RollCallReviewStatus = (typeof ROLL_CALL_REVIEW_STATUSES)[number];

/**
 * Pases de asistencia PENDIENTES de confirmar por Master, con la marca de
 * cada trabajador (estado + hora de llegada) para que Master vea y corrija
 * antes de confirmar que la asistencia es real.
 */
export async function listPendingRollCalls(branchId?: string) {
  const rollCalls = await prisma.attendanceRollCall.findMany({
    where: { reviewStatus: "PENDING", ...(branchId ? { branchId } : {}) },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      marks: {
        include: { employee: { select: { id: true, fullName: true, position: true } } },
        orderBy: { employee: { fullName: "asc" } },
      },
    },
    orderBy: [{ date: "desc" }],
  });
  return rollCalls;
}

/**
 * Master confirma (o corrige y confirma) un pase: `corrections` permite
 * cambiar el estado de trabajadores marcados falsamente antes de confirmar —
 * la corrección también ajusta EmployeeAbsence para que la nómina refleje lo
 * REAL, no lo que el cajero marcó.
 */
export async function confirmRollCall(
  rollCallId: string,
  corrections: Array<{ employeeId: string; status: RollCallStatus; notes?: string | null }> = [],
  actorUserId?: string,
) {
  const rollCall = await prisma.attendanceRollCall.findUnique({ where: { id: rollCallId }, include: { marks: true } });
  if (!rollCall) throw new Error("ROLL_CALL_NOT_FOUND");

  const markByEmployee = new Map(rollCall.marks.map((m) => [m.employeeId, m]));
  for (const c of corrections) {
    if (!ROLL_CALL_STATUSES.includes(c.status)) {
      throw new Error("INVALID_INPUT: status debe ser PRESENT, UNJUSTIFIED o JUSTIFIED");
    }
    if (!markByEmployee.has(c.employeeId)) {
      throw new Error("INVALID_INPUT: el empleado no pertenece a este pase");
    }
  }

  for (const c of corrections) {
    await prisma.attendanceMark.update({
      where: { rollCallId_employeeId: { rollCallId, employeeId: c.employeeId } },
      data: { status: c.status, notes: c.notes ?? null, arrivalAt: c.status === "PRESENT" ? new Date() : null },
    });
    if (c.status === "PRESENT") {
      await prisma.employeeAbsence.deleteMany({ where: { employeeId: c.employeeId, date: rollCall.date } });
    } else {
      await prisma.employeeAbsence.upsert({
        where: { employeeId_date: { employeeId: c.employeeId, date: rollCall.date } },
        create: { employeeId: c.employeeId, date: rollCall.date, kind: c.status, notes: c.notes ?? null, createdByUserId: actorUserId ?? null },
        update: { kind: c.status, notes: c.notes ?? null },
      });
    }
  }

  const finalMarks = await prisma.attendanceMark.findMany({ where: { rollCallId } });
  const presentCount = finalMarks.filter((m) => m.status === "PRESENT").length;
  const absentCount = finalMarks.length - presentCount;

  const updated = await prisma.attendanceRollCall.update({
    where: { id: rollCallId },
    data: {
      reviewStatus: "CONFIRMED",
      reviewedByUserId: actorUserId ?? null,
      reviewedAt: new Date(),
      presentCount,
      absentCount,
    },
    include: { marks: { include: { employee: { select: { id: true, fullName: true, position: true } } } } },
  });

  await logAuditEvent({
    actorUserId: actorUserId ?? undefined,
    branchId: rollCall.branchId,
    module: "payroll",
    action: "attendance_roll_call.confirmed",
    entityType: "AttendanceRollCall",
    entityId: rollCallId,
    metadataJson: { date: rollCall.date.toISOString().slice(0, 10), corrections: corrections.length, presentCount, absentCount },
  });

  return updated;
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
