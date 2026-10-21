import { Prisma, PrismaClient } from "@prisma/client";
import { getEffectiveProductPricingBatch } from "@/modules/catalog/effective-pricing";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * prompt-entrada-reintento-precio.md Commit 1 — "una sola función, usada
 * por la vista previa y por el guardado": antes de esto, la vista previa
 * resolvía costo con la cadena completa (`getEffectiveProductPricingBatch`
 * → `resolveCostChain`: branchCost > WAC > averageCost > globalCost >
 * lastPurchaseCost) pero el guardado (`createOpeningBalanceTx`,
 * costMode=QUANTITY_ONLY) solo miraba el WAC PROPIO de esa sucursal — dos
 * reglas distintas para lo mismo. IM-000008 (caso real, verificado contra
 * producción de solo lectura): BISAGRAS CRONO PAR 4"X4" tiene
 * averageCost=75 a nivel producto (desde 2026-06-12, por compras en MSY),
 * pero RIV nunca tuvo una fila de InventoryBalance — WAC de RIV = 0. La
 * vista previa veía effectiveCost=75 (GLOBAL_AVERAGE) y dejaba pasar la
 * línea; `createOpeningBalanceTx` solo miraba el WAC de RIV (0) y
 * reventaba con ZERO_COST_INBOUND. Esta función es la cadena ÚNICA —
 * branchCost/WAC siempre de LA sucursal pedida, nunca de otra ("costo de
 * otra sucursal no cuenta": `getEffectiveProductPricingBatch` ya solo lee
 * el balance de `branchId`, nunca de otro).
 *
 * Devuelve el costo en unidad de VENTA (la misma convención que
 * `line.unitCost` entrado por el usuario y que `effectiveCost` de
 * `getEffectiveProductPricingBatch`, que ya convierte el WAC de base a
 * venta) — la conversión a unidad BASE para el movimiento la sigue
 * haciendo, sin cambios, el código que ya existe en
 * `inventory/service.ts` (`convertSaleUnitCostToBaseUnitCost`). No se
 * duplica esa conversión acá.
 */
export type ResolvedInboundCostSource = "ENTERED" | "BRANCH" | "WAC_ESTIMATE" | "GLOBAL_AVERAGE" | "GLOBAL" | "LAST_PURCHASE" | "NONE";
export type ResolvedInboundCost = { cost: Prisma.Decimal | null; source: ResolvedInboundCostSource };

export type ResolveInboundUnitCostItem = { productId: string; branchId: string; enteredCost: number | Prisma.Decimal | null };

/**
 * Versión en lote — usada por la prevalidación por sucursal (Commit 1 §2,
 * todas las líneas antes de la primera tanda) y por la vista previa
 * (varias líneas a la vez). Una sola consulta a
 * `getEffectiveProductPricingBatch` para todo el lote, no una por línea.
 */
export async function resolveInboundUnitCostBatch(db: DbClient, items: ResolveInboundUnitCostItem[]): Promise<Map<string, ResolvedInboundCost>> {
  const result = new Map<string, ResolvedInboundCost>();
  if (items.length === 0) return result;

  const needsChain = items.filter((item) => !(item.enteredCost !== null && Number(item.enteredCost) > 0));
  const pricingByKey = needsChain.length > 0
    ? await getEffectiveProductPricingBatch(db, needsChain.map((item) => ({ productId: item.productId, branchId: item.branchId })))
    : new Map();

  for (const item of items) {
    const resultKey = `${item.branchId}:${item.productId}`;
    if (item.enteredCost !== null && Number(item.enteredCost) > 0) {
      result.set(resultKey, { cost: new Prisma.Decimal(item.enteredCost), source: "ENTERED" });
      continue;
    }
    const effective = pricingByKey.get(resultKey);
    if (effective?.effectiveCost && effective.effectiveCost.gt(0)) {
      result.set(resultKey, { cost: effective.effectiveCost, source: effective.costSource as ResolvedInboundCostSource });
    } else {
      result.set(resultKey, { cost: null, source: "NONE" });
    }
  }
  return result;
}

/** Una sola línea — delega en la versión en lote para no duplicar la regla. */
export async function resolveInboundUnitCost(db: DbClient, input: ResolveInboundUnitCostItem): Promise<ResolvedInboundCost> {
  const batch = await resolveInboundUnitCostBatch(db, [input]);
  return batch.get(`${input.branchId}:${input.productId}`) ?? { cost: null, source: "NONE" };
}
