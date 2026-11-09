import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * prompt-wac-desactivar.md — decisión del usuario: sacar el WAC de la
 * ecuación de costo/margen en TODO el sistema, de inmediato, de forma
 * reversible. docs/WAC-DESACTIVADO.md tiene el detalle completo de qué
 * quedó apagado y qué revisar antes de reactivar.
 *
 * Mismo patrón que cash-session/auto-close-config.ts: un valor guardado
 * en la tabla genérica `SystemSetting` (así se puede togglear desde
 * PUT /api/system-admin/settings sin migración ni redeploy — SYSTEM_ADMIN
 * únicamente), con cache TTL corto para no pagar una consulta a Neon en
 * cada resolución de costo (que se llama constantemente: catálogo, POS,
 * fusiones, Kardex).
 *
 * default = false: el WAC NO participa en la cadena de costo salvo que
 * alguien lo reactive explícito. `wac.ts`/`recalculateWeightedAverage`
 * siguen calculando el WAC en cada movimiento sin cambios — este flag
 * NO los toca, solo decide si el resto del sistema LEE ese número.
 */
const WAC_DRIVES_COST_CHAIN_SETTING_KEY = "wac_drives_cost_chain";

const CONFIG_CACHE_TTL_MS = 60_000;
let cache: { value: boolean; expiresAt: number } | null = null;

/** true/false explícito ("true"/"false") en el valor guardado; cualquier otra cosa (fila ausente, valor corrupto) cae al default false. */
function parseFlag(raw: string | undefined): boolean {
  return raw === "true";
}

/**
 * Lee si el WAC debe participar en la cadena de costo. Default false — ver
 * docs/WAC-DESACTIVADO.md.
 *
 * `db` opcional (default: el singleton `prisma`) — para que los llamadores
 * que ya tienen un `tx`/cliente inyectado (transacciones, o un fake db de
 * test como el de getEffectiveProductPricingBatch) lo pasen y esta lectura
 * quede en la misma conexión/mock, en vez de ir siempre al singleton real
 * por su cuenta.
 */
export async function isWacDrivesCostChainEnabled(db: DbClient = prisma): Promise<boolean> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const row = await db.systemSetting.findUnique({ where: { key: WAC_DRIVES_COST_CHAIN_SETTING_KEY } });
  const value = parseFlag(row?.value);
  cache = { value, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
  return value;
}
