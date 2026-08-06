/**
 * Ledger de vacaciones (Arts. 76–82 CT) — reemplaza el contador suelto que
 * antes vivía en Employee (vacationDaysTaken). Cada entrada es un evento REAL
 * con fecha: GOZADAS (descansadas, salario normal del período) o PAGADAS (en
 * dinero — gravable, ver vacationPayout). El saldo se calcula como acumulado
 * por período de aniversario laboral (vacationPeriodsToDate) menos la suma de
 * este ledger — auditable: se sabe CUÁNDO y QUÉ pasó, no un número suelto.
 */
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";

export const VACATION_ENTRY_KINDS = ["GOZADAS", "PAGADAS"] as const;
export type VacationEntryKind = (typeof VACATION_ENTRY_KINDS)[number];

function parseDate(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error("INVALID_INPUT: date debe ser YYYY-MM-DD");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (isNaN(date.getTime())) throw new Error("INVALID_INPUT: fecha inválida");
  return date;
}

export async function registerVacationEntry(
  input: { employeeId: string; date: string; days: number; kind: VacationEntryKind; notes?: string | null },
  actorUserId?: string,
) {
  if (!VACATION_ENTRY_KINDS.includes(input.kind)) {
    throw new Error("INVALID_INPUT: kind debe ser GOZADAS o PAGADAS");
  }
  if (!Number.isFinite(input.days) || input.days <= 0) {
    throw new Error("INVALID_INPUT: days debe ser mayor a 0");
  }
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, branchId: true } });
  if (!employee) throw new Error("EMPLOYEE_NOT_FOUND");
  const date = parseDate(input.date);
  if (date > new Date()) throw new Error("INVALID_INPUT: no se registran vacaciones de fechas futuras");

  const entry = await prisma.vacationEntry.create({
    data: { employeeId: input.employeeId, date, days: input.days, kind: input.kind, notes: input.notes ?? null, createdByUserId: actorUserId ?? null },
  });

  await logAuditEvent({
    actorUserId: actorUserId ?? undefined,
    branchId: employee.branchId,
    module: "payroll",
    action: "vacation_entry.registered",
    entityType: "VacationEntry",
    entityId: entry.id,
    metadataJson: { employeeId: input.employeeId, date: input.date, days: input.days, kind: input.kind },
  });

  return entry;
}

export async function deleteVacationEntry(id: string, actorUserId?: string) {
  const entry = await prisma.vacationEntry.findUnique({ where: { id }, include: { employee: { select: { branchId: true } } } });
  if (!entry) throw new Error("VACATION_ENTRY_NOT_FOUND");
  await prisma.vacationEntry.delete({ where: { id } });

  await logAuditEvent({
    actorUserId: actorUserId ?? undefined,
    branchId: entry.employee.branchId,
    module: "payroll",
    action: "vacation_entry.deleted",
    entityType: "VacationEntry",
    entityId: id,
    metadataJson: { employeeId: entry.employeeId, days: Number(entry.days), kind: entry.kind },
  });

  return { deleted: true };
}

/** Historial completo de un empleado (para el drawer). */
export async function listVacationEntries(employeeId: string) {
  return prisma.vacationEntry.findMany({ where: { employeeId }, orderBy: { date: "desc" } });
}

/** Total de días consumidos (gozados + pagados) por empleado — para el saldo. */
export async function vacationDaysTakenByEmployee(employeeIds: string[]): Promise<Map<string, number>> {
  if (employeeIds.length === 0) return new Map();
  const grouped = await prisma.vacationEntry.groupBy({
    by: ["employeeId"],
    where: { employeeId: { in: employeeIds } },
    _sum: { days: true },
  });
  return new Map(grouped.map((g) => [g.employeeId, Number(g._sum.days ?? 0)]));
}
