import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * prompt-produccion-materiales.md Fase 4 — días de cobertura para la
 * demanda de las recomendaciones: faltante = max(reorden, días_cobertura ×
 * venta_diaria) − stock. Mismo mecanismo que cash-tolerance-config.ts /
 * cost-chain-config.ts (SystemSetting, togglable desde PUT
 * /api/system-admin/settings sin UI nueva ni redeploy) — sin cache TTL a
 * propósito: getProductionRecommendationsForBranch la lee UNA vez por
 * llamada (no en un loop por producto), así que cachear no ahorra nada, y
 * el test que cuenta consultas ("menos de 10 consultas") necesita que esta
 * lectura sea determinística, no condicionada a si otro test ya calentó
 * la cache dentro del mismo archivo.
 */
export const PRODUCTION_DEMAND_SETTING_KEY = "production_demand_config";

export type ProductionDemandConfig = { coverageDays: number };
export const DEFAULT_PRODUCTION_DEMAND_CONFIG: ProductionDemandConfig = { coverageDays: 14 };

export async function getProductionDemandConfig(db: DbClient = prisma): Promise<ProductionDemandConfig> {
  const row = await db.systemSetting.findUnique({ where: { key: PRODUCTION_DEMAND_SETTING_KEY } });
  if (!row) return DEFAULT_PRODUCTION_DEMAND_CONFIG;
  try {
    const parsed = JSON.parse(row.value) as Partial<ProductionDemandConfig>;
    if (typeof parsed.coverageDays === "number" && Number.isFinite(parsed.coverageDays) && parsed.coverageDays > 0) {
      return { coverageDays: parsed.coverageDays };
    }
    return DEFAULT_PRODUCTION_DEMAND_CONFIG;
  } catch {
    return DEFAULT_PRODUCTION_DEMAND_CONFIG;
  }
}
