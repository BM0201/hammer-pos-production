/**
 * Configuración de nómina (PayrollRateConfig, fila única) + conteo global de
 * empleados activos.
 *
 * La fila en DB es opcional: sin fila, rigen los DEFAULT_PAYROLL_RATES del
 * módulo puro (payroll-nicaragua.ts). Las tasas INSS ya NO se editan sueltas:
 * se derivan del régimen (INTEGRAL / IVM_RP) y del conteo de trabajadores
 * activos de TODA la empresa (<50 / ≥50) vía resolveInssRates — al cruzar el
 * umbral de 50, la tasa patronal cambia sola en todos los cálculos.
 */
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import {
  DEFAULT_PAYROLL_RATES,
  resolveInssRates,
  type BenefitAccrualMode,
  type InssRegime,
  type PayrollRates,
} from "./payroll-nicaragua";

const INSS_REGIMES: readonly InssRegime[] = ["INTEGRAL", "IVM_RP"];
const BENEFIT_MODES: readonly BenefitAccrualMode[] = ["ACCRUE_MONTHLY", "ON_PAYMENT"];

/**
 * Config vigente: fila de PayrollRateConfig (o defaults) + conteo GLOBAL de
 * empleados activos. El conteo es de toda la empresa (todas las sucursales):
 * así lo define el Decreto 06-2019 para la tasa patronal por tamaño.
 */
export async function getPayrollRates(): Promise<PayrollRates> {
  const [row, activeEmployeeCount] = await Promise.all([
    prisma.payrollRateConfig.findFirst({ orderBy: { createdAt: "asc" } }),
    prisma.employee.count({ where: { isActive: true } }),
  ]);
  if (!row) return { ...DEFAULT_PAYROLL_RATES, activeEmployeeCount };
  return {
    inssRegime: row.inssRegime,
    activeEmployeeCount,
    inatecRate: DEFAULT_PAYROLL_RATES.inatecRate,
    aguinaldoMode: row.aguinaldoMode,
    vacacionesMode: row.vacacionesMode,
    indemnizacionMode: row.indemnizacionMode,
    salarioMinimoSectorial: Number(row.salarioMinimoSectorial) || 0,
  };
}

/** Tasas INSS resueltas para una config (conveniencia para endpoints/UI). */
export function resolvedInssRatesFor(rates: PayrollRates) {
  return resolveInssRates(rates.inssRegime, rates.activeEmployeeCount);
}

export type UpdatePayrollRatesInput = {
  inssRegime?: InssRegime;
  aguinaldoMode?: BenefitAccrualMode;
  vacacionesMode?: BenefitAccrualMode;
  indemnizacionMode?: BenefitAccrualMode;
  salarioMinimoSectorial?: number;
};

const MODE_FIELDS = ["aguinaldoMode", "vacacionesMode", "indemnizacionMode"] as const;

export async function updatePayrollRates(input: UpdatePayrollRatesInput, actorUserId?: string): Promise<PayrollRates> {
  const data: Record<string, unknown> = {};

  if (input.inssRegime !== undefined) {
    if (!INSS_REGIMES.includes(input.inssRegime)) {
      throw new Error("INVALID_INPUT: inssRegime debe ser INTEGRAL o IVM_RP");
    }
    data.inssRegime = input.inssRegime;
  }
  for (const field of MODE_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (!BENEFIT_MODES.includes(value)) {
      throw new Error(`INVALID_INPUT: ${field} debe ser ACCRUE_MONTHLY u ON_PAYMENT`);
    }
    data[field] = value;
  }
  if (input.salarioMinimoSectorial !== undefined) {
    if (!Number.isFinite(input.salarioMinimoSectorial) || input.salarioMinimoSectorial < 0) {
      throw new Error("INVALID_INPUT: salarioMinimoSectorial debe ser un monto ≥ 0");
    }
    data.salarioMinimoSectorial = input.salarioMinimoSectorial;
  }
  if (Object.keys(data).length === 0) {
    throw new Error("INVALID_INPUT: No hay configuración para actualizar");
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
