/**
 * Cierre de prompt-entrada-inventario.md — consulta de SOLO LECTURA:
 * "cuántas cargas con modo 'fijar stock' se hicieron en los últimos 60 días
 * sobre productos que ya tenían stock, con la diferencia total de
 * unidades." Sirve para saber si el modo por defecto de la pantalla vieja
 * (OpeningBalanceModal, "Fijar stock físico final (recomendado)") ya borró
 * existencias sin querer.
 *
 * Limitación honesta: InventoryMovement no guarda qué stockMode se usó
 * (SET_PHYSICAL_STOCK vs ADD_TO_STOCK) — ambos escriben el mismo tipo de
 * movimiento (ADJUSTMENT_IN/OUT) con el delta ya aplicado. Pero hay un
 * discriminador matemático real: ADD_TO_STOCK ("sumar") SIEMPRE suma una
 * cantidad positiva → NUNCA puede producir un ADJUSTMENT_OUT. Por lo tanto:
 *   - Todo ADJUSTMENT_OUT con referenceType OPENING_BALANCE/_BULK es
 *     PRUEBA de que se usó "fijar" (SET_PHYSICAL_STOCK) y bajó el stock.
 *   - Un ADJUSTMENT_IN con esos referenceType es AMBIGUO (pudo ser "fijar"
 *     hacia arriba o "sumar" legítimo) — se reporta aparte, nunca mezclado
 *     con el número "seguro" de arriba.
 *
 * Solo lee — no escribe nada.
 * Uso: npx tsx scripts/report-fijar-stock-on-existing-stock.ts [días=60]
 */
import { prisma } from "@/lib/prisma";

const OPENING_REFERENCE_TYPES = ["OPENING_BALANCE", "OPENING_BALANCE_BULK"];

async function main() {
  const days = Number(process.argv[2] ?? 60) || 60;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const candidateMovements = await prisma.inventoryMovement.findMany({
    where: { referenceType: { in: OPENING_REFERENCE_TYPES }, createdAt: { gte: since } },
    select: { id: true, branchId: true, productId: true, movementType: true, quantity: true, createdAt: true, referenceType: true, referenceId: true, product: { select: { sku: true, name: true } }, branch: { select: { code: true } } },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Ventana: últimos ${days} días (desde ${since.toISOString()}).`);
  console.log(`${candidateMovements.length} movimiento(s) con referenceType OPENING_BALANCE/OPENING_BALANCE_BULK en la ventana.\n`);

  if (candidateMovements.length === 0) {
    console.log("Nada que reportar.");
    return;
  }

  // Historial COMPLETO (sin límite de fecha) de cada (branch, producto) tocado, para reconstruir el saldo justo ANTES de cada movimiento candidato.
  const pairs = [...new Set(candidateMovements.map((m) => `${m.branchId}:${m.productId}`))];
  const branchIds = [...new Set(candidateMovements.map((m) => m.branchId))];
  const productIds = [...new Set(candidateMovements.map((m) => m.productId))];
  const fullHistory = await prisma.inventoryMovement.findMany({
    where: { branchId: { in: branchIds }, productId: { in: productIds } },
    select: { branchId: true, productId: true, movementType: true, quantity: true, createdAt: true, id: true },
    orderBy: { createdAt: "asc" },
  });
  const historyByPair = new Map<string, typeof fullHistory>();
  for (const pair of pairs) historyByPair.set(pair, []);
  for (const m of fullHistory) {
    const key = `${m.branchId}:${m.productId}`;
    historyByPair.get(key)?.push(m);
  }

  function isInbound(movementType: string): boolean {
    return movementType.endsWith("_IN") || movementType === "PURCHASE_IN" || movementType === "PRODUCTION_OUTPUT";
  }

  function balanceBefore(branchId: string, productId: string, beforeId: string): number {
    const history = historyByPair.get(`${branchId}:${productId}`) ?? [];
    let balance = 0;
    for (const m of history) {
      if (m.id === beforeId) break;
      balance += isInbound(m.movementType) ? Number(m.quantity) : -Number(m.quantity);
    }
    return balance;
  }

  const confirmedSetOnExistingStock: typeof candidateMovements = [];
  const ambiguousInOnExistingStock: typeof candidateMovements = [];
  let confirmedUnitsDiff = 0;
  let ambiguousUnitsDiff = 0;

  for (const m of candidateMovements) {
    const priorBalance = balanceBefore(m.branchId, m.productId, m.id);
    if (priorBalance <= 0) continue; // "ya tenía stock" — si no tenía, no aplica a este reporte.
    if (m.movementType === "ADJUSTMENT_OUT") {
      confirmedSetOnExistingStock.push(m);
      confirmedUnitsDiff += Number(m.quantity);
    } else if (m.movementType === "ADJUSTMENT_IN") {
      ambiguousInOnExistingStock.push(m);
      ambiguousUnitsDiff += Number(m.quantity);
    }
  }

  console.log("── CONFIRMADO (ADJUSTMENT_OUT — matemáticamente solo puede venir de 'fijar', nunca de 'sumar') ──");
  console.log(`${confirmedSetOnExistingStock.length} carga(s) de 'fijar stock' bajaron existencias que YA había. Unidades totales perdidas: ${confirmedUnitsDiff}.`);
  for (const m of confirmedSetOnExistingStock) {
    console.log(`  ${m.createdAt.toISOString().slice(0, 10)} · ${m.branch.code} · ${m.product.sku} ${m.product.name} · -${Number(m.quantity)} · ref=${m.referenceType}/${m.referenceId}`);
  }

  console.log("\n── AMBIGUO (ADJUSTMENT_IN — pudo ser 'fijar' hacia arriba O 'sumar' legítimo; no se puede separar con los datos guardados) ──");
  console.log(`${ambiguousInOnExistingStock.length} carga(s) en productos que ya tenían stock. Unidades totales (si TODAS fueran 'fijar'): ${ambiguousUnitsDiff}.`);
  for (const m of ambiguousInOnExistingStock) {
    console.log(`  ${m.createdAt.toISOString().slice(0, 10)} · ${m.branch.code} · ${m.product.sku} ${m.product.name} · +${Number(m.quantity)} · ref=${m.referenceType}/${m.referenceId}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
