import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * prompt-inventario-unificado.md Commit 1 §3 — sucursal "principal" de
 * Inventario (la que se marca con ★ en el desplegable y es el último
 * fallback si no hay nada guardado ni en la URL ni en localStorage).
 * Mismo patrón que cost-chain-config.ts: un valor en `SystemSetting`, con
 * cache corto, togglebale sin migración ni redeploy.
 *
 * Sin configurar (valor ausente, el caso de hoy): `getPrimaryInventoryBranchId`
 * devuelve null — nunca "MGA" a secas ("nada de sucursales escritas en el
 * código"). El fallback final, cuando esto es null, es la primera sucursal
 * ACTIVA ordenada por código (ver inventory-scope-logic.ts en el frontend)
 * — hoy eso ya da Managua Central por orden alfabético real (MGA < MSY <
 * RIV), no porque el código la nombre.
 */
export const PRIMARY_INVENTORY_BRANCH_SETTING_KEY = "primary_inventory_branch_id";

const CONFIG_CACHE_TTL_MS = 60_000;
let cache: { value: string | null; expiresAt: number } | null = null;

export async function getPrimaryInventoryBranchId(db: DbClient = prisma): Promise<string | null> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const row = await db.systemSetting.findUnique({ where: { key: PRIMARY_INVENTORY_BRANCH_SETTING_KEY } });
  const value = row?.value || null;
  cache = { value, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
  return value;
}

export async function setPrimaryInventoryBranchId(branchId: string, actorUserId?: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: PRIMARY_INVENTORY_BRANCH_SETTING_KEY },
    create: { key: PRIMARY_INVENTORY_BRANCH_SETTING_KEY, value: branchId, updatedByUserId: actorUserId ?? null },
    update: { value: branchId, updatedByUserId: actorUserId ?? null },
  });
  cache = { value: branchId, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
  await logAuditEvent({
    actorUserId,
    module: "catalog-inventory",
    action: "PRIMARY_INVENTORY_BRANCH_CHANGED",
    entityType: "SystemSetting",
    entityId: PRIMARY_INVENTORY_BRANCH_SETTING_KEY,
    metadataJson: { branchId },
  });
}
