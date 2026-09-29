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
import { Prisma, PrismaClient, type PayrollLegalRateVersion } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import {
  DEFAULT_LEGAL_RATES,
  DEFAULT_PAYROLL_RATES,
  resolveInssRates,
  type BenefitAccrualMode,
  type InssRegime,
  type IrBracket,
  type LegalRates,
  type LegalRatesInput,
  type PayrollRates,
} from "./payroll-nicaragua";

const INSS_REGIMES: readonly InssRegime[] = ["INTEGRAL", "IVM_RP"];
const BENEFIT_MODES: readonly BenefitAccrualMode[] = ["ACCRUE_MONTHLY", "ON_PAYMENT"];

/** DbClient inyectable (mismo patrón que purchase-orders/payables.ts) — solo para las funciones de lectura/decisión que se testean sin DB real. */
type DbClient = PrismaClient | Prisma.TransactionClient;

export type PayrollPeriod = { year: number; month: number };

/** Primer día del mes (UTC) para un período dado, o del mes actual sin período. */
function monthStartUtc(period?: PayrollPeriod): Date {
  if (period) return new Date(Date.UTC(period.year, period.month - 1, 1));
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
}

function legalRatesFromRow(row: PayrollLegalRateVersion): LegalRates {
  return {
    inssIntegralLaboral: Number(row.inssIntegralLaboral),
    inssIntegralPatronalLt50: Number(row.inssIntegralPatronalLt50),
    inssIntegralPatronalGte50: Number(row.inssIntegralPatronalGte50),
    inssIvmRpLaboral: Number(row.inssIvmRpLaboral),
    inssIvmRpPatronalLt50: Number(row.inssIvmRpPatronalLt50),
    inssIvmRpPatronalGte50: Number(row.inssIvmRpPatronalGte50),
    inssEmployerSizeThreshold: row.inssEmployerSizeThreshold,
    inatecRate: Number(row.inatecRate),
    irTableAnnual: row.irTableAnnual as unknown as IrBracket[],
  };
}

export type LegalRatesResolution = { legal: LegalRates; source: "DEFAULT" | string };

/**
 * prompt-nomina-config.md Fase 2.3 — la versión con effectiveFrom más
 * reciente que sea ≤ el primer día del mes del período (o del mes actual,
 * sin período). Sin ninguna versión aplicable, DEFAULT_LEGAL_RATES (mismos
 * resultados que hoy). Una planilla de marzo recalculada en mayo, con una
 * reforma vigente desde abril, sigue usando las tasas de marzo.
 */
export async function resolveLegalRates(period?: PayrollPeriod, db: DbClient = prisma): Promise<LegalRatesResolution> {
  const monthStart = monthStartUtc(period);
  const version = await db.payrollLegalRateVersion.findFirst({
    where: { effectiveFrom: { lte: monthStart } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!version) return { legal: DEFAULT_LEGAL_RATES, source: "DEFAULT" };
  return { legal: legalRatesFromRow(version), source: version.id };
}

/**
 * Config vigente: fila de PayrollRateConfig (o defaults) + conteo GLOBAL de
 * empleados activos + tasas legales del período (ver resolveLegalRates). El
 * conteo es de toda la empresa (todas las sucursales): así lo define el
 * Decreto 06-2019 para la tasa patronal por tamaño.
 */
export async function getPayrollRates(period?: PayrollPeriod): Promise<PayrollRates> {
  const [row, activeEmployeeCount, { legal }] = await Promise.all([
    prisma.payrollRateConfig.findFirst({ orderBy: { createdAt: "asc" } }),
    prisma.employee.count({ where: { isActive: true } }),
    resolveLegalRates(period),
  ]);
  if (!row) return { ...DEFAULT_PAYROLL_RATES, activeEmployeeCount, inatecRate: legal.inatecRate, legal };
  return {
    inssRegime: row.inssRegime,
    activeEmployeeCount,
    // Espejea legal.inatecRate — se mantiene por compatibilidad (varios
    // consumidores todavía leen inatecRate directo), pero legal es la
    // fuente real. Antes de la Fase 2 ignoraba la fila y usaba SIEMPRE la
    // constante; ahora sigue la versión vigente del período.
    inatecRate: legal.inatecRate,
    aguinaldoMode: row.aguinaldoMode,
    vacacionesMode: row.vacacionesMode,
    indemnizacionMode: row.indemnizacionMode,
    salarioMinimoSectorial: Number(row.salarioMinimoSectorial) || 0,
    legal,
  };
}

/**
 * prompt-nomina-config.md Fase 1 — cantidad de empleados activos por debajo
 * del salario mínimo sectorial vigente, para el aviso informativo de la
 * pantalla de configuración (no bloquea nada, mismo criterio que el propio
 * salarioMinimoSectorial). Sin mínimo configurado (0), no hay nada que
 * advertir.
 */
export async function countActiveEmployeesBelowMinimum(salarioMinimoSectorial: number): Promise<number> {
  if (!salarioMinimoSectorial || salarioMinimoSectorial <= 0) return 0;
  return prisma.employee.count({
    where: { isActive: true, monthlySalary: { lt: salarioMinimoSectorial } },
  });
}

/** Tasas INSS resueltas para una config (conveniencia para endpoints/UI). */
export function resolvedInssRatesFor(rates: PayrollRates) {
  return resolveInssRates(rates.inssRegime, rates.activeEmployeeCount, rates.legal);
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

/* ── Reformas legales: versiones (prompt-nomina-config.md Fase 2.4) ─────────── */

/**
 * ¿Hay una PayrollRun POSTED de un mes en o después de effectiveFrom? Una
 * reforma retroactiva sobre meses ya cerrados no se hace desde acá — ni
 * para crear una versión que la afecte, ni para borrar una que la afectó.
 * Exportada (con `db` inyectable) para poder testear el guard sin DB real.
 */
export async function hasPostedRunFromEffectiveFrom(effectiveFrom: Date, db: DbClient = prisma): Promise<boolean> {
  const year = effectiveFrom.getUTCFullYear();
  const month = effectiveFrom.getUTCMonth() + 1;
  const count = await db.payrollRun.count({
    where: {
      status: "POSTED",
      OR: [
        { year: { gt: year } },
        { year, month: { gte: month } },
      ],
    },
  });
  return count > 0;
}

export type LegalRateVersionSummary = LegalRates & {
  id: string;
  effectiveFrom: string;
  legalBasis: string;
  createdByUserId: string | null;
  createdAt: string;
  /** Calculado en el servidor: false si ya hay una corrida POSTED en o después de effectiveFrom. */
  deletable: boolean;
};

/** Historial completo, más reciente primero. Volumen bajo (una reforma legal no es frecuente) — no hace falta batching. */
export async function listLegalRateVersions(): Promise<LegalRateVersionSummary[]> {
  const versions = await prisma.payrollLegalRateVersion.findMany({ orderBy: { effectiveFrom: "desc" } });
  return Promise.all(
    versions.map(async (v) => ({
      id: v.id,
      effectiveFrom: v.effectiveFrom.toISOString(),
      legalBasis: v.legalBasis,
      createdByUserId: v.createdByUserId,
      createdAt: v.createdAt.toISOString(),
      deletable: !(await hasPostedRunFromEffectiveFrom(v.effectiveFrom)),
      ...legalRatesFromRow(v),
    })),
  );
}

/**
 * Crea una versión de tasas legales. El llamador (la ruta) ya corrió
 * validateLegalRates — acá solo las reglas que dependen de la base de
 * datos: el mes no puede tener una corrida POSTED, y no puede repetirse un
 * effectiveFrom.
 */
export async function createLegalRateVersion(
  input: LegalRatesInput & { effectiveFrom: string | Date },
  actorUserId?: string,
): Promise<LegalRateVersionSummary> {
  const raw = new Date(input.effectiveFrom);
  if (Number.isNaN(raw.getTime())) {
    throw new Error("INVALID_INPUT: effectiveFrom invalido");
  }
  // Se normaliza al primer día del mes: la versión rige para el MES completo.
  const effectiveFrom = new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), 1));

  if (await hasPostedRunFromEffectiveFrom(effectiveFrom)) {
    throw new Error("LEGAL_RATES_PERIOD_ALREADY_POSTED");
  }
  const existing = await prisma.payrollLegalRateVersion.findUnique({ where: { effectiveFrom } });
  if (existing) {
    throw new Error("LEGAL_RATES_VERSION_EXISTS");
  }

  const version = await prisma.payrollLegalRateVersion.create({
    data: {
      effectiveFrom,
      inssIntegralLaboral: input.inssIntegralLaboral,
      inssIntegralPatronalLt50: input.inssIntegralPatronalLt50,
      inssIntegralPatronalGte50: input.inssIntegralPatronalGte50,
      inssIvmRpLaboral: input.inssIvmRpLaboral,
      inssIvmRpPatronalLt50: input.inssIvmRpPatronalLt50,
      inssIvmRpPatronalGte50: input.inssIvmRpPatronalGte50,
      inssEmployerSizeThreshold: input.inssEmployerSizeThreshold,
      inatecRate: input.inatecRate,
      irTableAnnual: input.irTableAnnual as unknown as Prisma.InputJsonValue,
      legalBasis: input.legalBasis.trim(),
      createdByUserId: actorUserId ?? null,
    },
  });

  await logAuditEvent({
    actorUserId: actorUserId ?? undefined,
    module: "payroll",
    action: "payroll_legal_rates.created",
    entityType: "PayrollLegalRateVersion",
    entityId: version.id,
    metadataJson: { ...input, effectiveFrom: effectiveFrom.toISOString() },
  });

  return {
    id: version.id,
    effectiveFrom: effectiveFrom.toISOString(),
    legalBasis: version.legalBasis,
    createdByUserId: version.createdByUserId,
    createdAt: version.createdAt.toISOString(),
    deletable: true, // recién creada: por construcción no puede haber una corrida POSTED después (se rechazó arriba).
    ...legalRatesFromRow(version),
  };
}

/** Borra una versión — solo si no hay corridas POSTED desde su effectiveFrom. No hay edición: para corregir, se borra y se crea otra. */
export async function deleteLegalRateVersion(id: string, actorUserId?: string): Promise<void> {
  const version = await prisma.payrollLegalRateVersion.findUnique({ where: { id } });
  if (!version) throw new Error("NOT_FOUND");
  if (await hasPostedRunFromEffectiveFrom(version.effectiveFrom)) {
    throw new Error("LEGAL_RATES_PERIOD_ALREADY_POSTED");
  }
  await prisma.payrollLegalRateVersion.delete({ where: { id } });
  await logAuditEvent({
    actorUserId: actorUserId ?? undefined,
    module: "payroll",
    action: "payroll_legal_rates.deleted",
    entityType: "PayrollLegalRateVersion",
    entityId: id,
    metadataJson: { effectiveFrom: version.effectiveFrom.toISOString(), legalBasis: version.legalBasis },
  });
}
