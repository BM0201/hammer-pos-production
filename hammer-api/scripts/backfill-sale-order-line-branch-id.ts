/**
 * Backfill de SaleOrderLine.branchId (Fase 3 de prompt-flujo-velocidad.md).
 *
 * La migración 20260919010000_sale_order_line_branch_id agrega la columna
 * nullable pero NO la llena — un backfill masivo dentro de la migración
 * bloquearía el deploy si la tabla ya creció. Este script llena las filas
 * viejas (branchId IS NULL) copiando SaleOrder.branchId, en lotes, para no
 * sostener un lock largo sobre una tabla de venta en producción. Las filas
 * NUEVAS ya nacen con branchId lleno (addSaleOrderLine, offline-sync) desde
 * el mismo commit que esta migración — este script es solo para el
 * historial existente al momento del deploy.
 *
 * Uso:
 *   npx tsx scripts/backfill-sale-order-line-branch-id.ts             # ejecuta el backfill
 *   npx tsx scripts/backfill-sale-order-line-branch-id.ts --dry-run    # solo cuenta cuántas filas faltan
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BATCH_SIZE = 2000;

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const pendingCount = await prisma.saleOrderLine.count({ where: { branchId: null } });
  console.log(`${dryRun ? "[DRY RUN] " : ""}Líneas con branchId pendiente de backfill: ${pendingCount}`);

  if (dryRun || pendingCount === 0) {
    if (pendingCount === 0) console.log("Nada que hacer — todas las líneas ya tienen branchId.");
    return;
  }

  let totalUpdated = 0;
  let batchCount = 0;

  // Un lote a la vez, cada uno su propia sentencia (no una transacción
  // gigante) — así un backfill largo no sostiene un solo lock de principio
  // a fin sobre la tabla de ventas mientras el sistema sigue vendiendo.
  for (;;) {
    const updated = await prisma.$executeRaw`
      UPDATE "SaleOrderLine" AS sol
      SET "branchId" = so."branchId"
      FROM "SaleOrder" AS so
      WHERE so.id = sol."saleOrderId"
        AND sol.id IN (
          SELECT id FROM "SaleOrderLine" WHERE "branchId" IS NULL LIMIT ${BATCH_SIZE}
        )
    `;
    if (updated === 0) break;
    totalUpdated += updated;
    batchCount += 1;
    console.log(`Lote ${batchCount}: ${updated} filas actualizadas (acumulado: ${totalUpdated})`);
  }

  console.log(`Backfill completo. Total actualizado: ${totalUpdated}.`);

  const stillMissing = await prisma.saleOrderLine.count({ where: { branchId: null } });
  if (stillMissing > 0) {
    // Solo puede pasar si una línea apunta a un SaleOrder ya borrado (no
    // debería, saleOrderId es una FK obligatoria) — se deja como
    // advertencia explícita en vez de asumir que es seguro ignorarlo.
    console.warn(`ADVERTENCIA: quedaron ${stillMissing} líneas sin branchId tras el backfill — revisar antes de asumir que terminó.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
