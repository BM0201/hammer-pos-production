/**
 * Parte C (prompt-completo-pendientes-2026-10.md) — "Al terminar": si
 * SaleOrderLine.costSnapshot viene vacío en una parte grande de las
 * ventas, decirlo con el % — de eso depende "Como lo venís vendiendo"
 * (REALIZED_MARGIN), que solo puede usar líneas CON costSnapshot.
 *
 * Solo lectura. Ejecutar con: npx tsx scripts/diagnose-cost-snapshot-coverage.ts
 */
import { prisma } from "@/lib/prisma";

const SALE_STATUSES = ["PAID", "DISPATCH_PENDING", "DISPATCHED"] as const;

async function main() {
  const since90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const [totalAllTime, withSnapshotAllTime, total90d, withSnapshot90d] = await Promise.all([
    prisma.saleOrderLine.count({ where: { saleOrder: { status: { in: [...SALE_STATUSES] } } } }),
    prisma.saleOrderLine.count({ where: { costSnapshot: { not: null }, saleOrder: { status: { in: [...SALE_STATUSES] } } } }),
    prisma.saleOrderLine.count({ where: { saleOrder: { status: { in: [...SALE_STATUSES] }, createdAt: { gte: since90d } } } }),
    prisma.saleOrderLine.count({ where: { costSnapshot: { not: null }, saleOrder: { status: { in: [...SALE_STATUSES] }, createdAt: { gte: since90d } } } }),
  ]);

  console.log(JSON.stringify({
    last90Days: {
      totalLines: total90d,
      linesWithCostSnapshot: withSnapshot90d,
      coveragePercent: total90d > 0 ? Number(((withSnapshot90d / total90d) * 100).toFixed(1)) : null,
      missingPercent: total90d > 0 ? Number((((total90d - withSnapshot90d) / total90d) * 100).toFixed(1)) : null,
    },
    allTime: {
      totalLines: totalAllTime,
      linesWithCostSnapshot: withSnapshotAllTime,
      coveragePercent: totalAllTime > 0 ? Number(((withSnapshotAllTime / totalAllTime) * 100).toFixed(1)) : null,
    },
  }, null, 2));
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
