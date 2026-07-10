/**
 * Tasas de nómina configurables (PayrollRateConfig, fila única).
 *
 * La fila en DB es opcional: sin fila, rigen los DEFAULT_PAYROLL_RATES del
 * módulo puro (payroll-nicaragua.ts). Editar tasas crea/actualiza la fila —
 * pensado para el cambio de régimen del INSS patronal (21.5% ↔ 22.5% al pasar
 * de <50 a ≥50 empleados) sin tocar código.
 */
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { DEFAULT_PAYROLL_RATES, type PayrollRates } from "./payroll-nicaragua";

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Tasas vigentes: fila de PayrollRateConfig si existe, defaults si no. */
export async function getPayrollRates(): Promise<PayrollRates> {
  const row = await prisma.payrollRateConfig.findFirst({ orderBy: { createdAt: "asc" } });
  if (!row) return { ...DEFAULT_PAYROLL_RATES };
  return {
    inssLaboralRate: num(row.inssLaboralRate, DEFAULT_PAYROLL_RATES.inssLaboralRate),
    inssPatronalRate: num(row.inssPatronalRate, DEFAULT_PAYROLL_RATES.inssPatronalRate),
    inatecRate: num(row.inatecRate, DEFAULT_PAYROLL_RATES.inatecRate),
    provisionAguinaldo: num(row.provisionAguinaldo, DEFAULT_PAYROLL_RATES.provisionAguinaldo),
    provisionVacaciones: num(row.provisionVacaciones, DEFAULT_PAYROLL_RATES.provisionVacaciones),
    provisionIndemnizacion: num(row.provisionIndemnizacion, DEFAULT_PAYROLL_RATES.provisionIndemnizacion),
    provisionsEnabled: row.provisionsEnabled,
  };
}

export type UpdatePayrollRatesInput = Partial<PayrollRates>;

const RATE_FIELDS = [
  "inssLaboralRate",
  "inssPatronalRate",
  "inatecRate",
  "provisionAguinaldo",
  "provisionVacaciones",
  "provisionIndemnizacion",
] as const;

export async function updatePayrollRates(input: UpdatePayrollRatesInput, actorUserId?: string): Promise<PayrollRates> {
  const data: Record<string, unknown> = {};
  for (const field of RATE_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`INVALID_INPUT: ${field} debe ser una tasa entre 0 y 1`);
    }
    data[field] = value;
  }
  if (input.provisionsEnabled !== undefined) data.provisionsEnabled = Boolean(input.provisionsEnabled);
  if (Object.keys(data).length === 0) {
    throw new Error("INVALID_INPUT: No hay tasas para actualizar");
  }
  data.updatedByUserId = actorUserId ?? null;

  const existing = await prisma.payrollRateConfig.findFirst({ orderBy: { createdAt: "asc" } });
  const row = existing
    ? await prisma.payrollRateConfig.update({ where: { id: existing.id }, data })
    : await prisma.payrollRateConfig.create({ data });

  await logAuditEvent({
    actorUserId: actorUserId ?? undefined,
    module: "payroll",
    action: "payroll_rates.updated",
    entityType: "PayrollRateConfig",
    entityId: row.id,
    metadataJson: input,
  });

  return getPayrollRates();
}
