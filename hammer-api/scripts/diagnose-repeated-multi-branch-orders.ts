/**
 * Parte B.3 (prompt-completo-pendientes-2026-10.md) — consulta de SOLO
 * LECTURA para el reporte final: en los últimos 60 días, cuántas órdenes de
 * compra del mismo proveedor, creadas el mismo día para sucursales
 * distintas, tienen EXACTAMENTE los mismos productos y cantidades. Mide
 * cuánto se repetía la carga manual antes de la matriz multisucursal.
 *
 * No escribe nada — solo SELECT. Ejecutar con: npx tsx scripts/diagnose-repeated-multi-branch-orders.ts
 */
import { prisma } from "@/lib/prisma";

async function main() {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const orders = await prisma.purchaseOrder.findMany({
    where: { createdAt: { gte: since }, supplierId: { not: null } },
    select: {
      id: true,
      orderNumber: true,
      supplierId: true,
      branchId: true,
      createdAt: true,
      lines: { select: { productId: true, quantity: true } },
    },
  });

  function dayKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
  function lineSetKey(lines: { productId: string; quantity: unknown }[]): string {
    return lines
      .map((l) => `${l.productId}:${Number(l.quantity)}`)
      .sort()
      .join("|");
  }

  // Agrupa por (proveedor, día) — dentro de cada grupo, por conjunto exacto de líneas.
  const bySupplierDay = new Map<string, typeof orders>();
  for (const o of orders) {
    const key = `${o.supplierId}::${dayKey(o.createdAt)}`;
    if (!bySupplierDay.has(key)) bySupplierDay.set(key, []);
    bySupplierDay.get(key)!.push(o);
  }

  let groupsWithRepetition = 0;
  let ordersInvolved = 0;
  const examples: Array<{ supplierId: string; day: string; branches: string[]; orderNumbers: string[]; lineCount: number }> = [];

  for (const [key, group] of bySupplierDay) {
    if (group.length < 2) continue;
    const distinctBranches = new Set(group.map((o) => o.branchId));
    if (distinctBranches.size < 2) continue; // mismo proveedor+día pero todas en la misma sucursal: no es el patrón que buscamos

    const byLineSet = new Map<string, typeof group>();
    for (const o of group) {
      const lk = lineSetKey(o.lines);
      if (!byLineSet.has(lk)) byLineSet.set(lk, []);
      byLineSet.get(lk)!.push(o);
    }

    for (const [lineSet, matchingOrders] of byLineSet) {
      const branchesInMatch = new Set(matchingOrders.map((o) => o.branchId));
      if (matchingOrders.length >= 2 && branchesInMatch.size >= 2 && lineSet !== "") {
        groupsWithRepetition += 1;
        ordersInvolved += matchingOrders.length;
        if (examples.length < 10) {
          const [supplierId, day] = key.split("::");
          examples.push({
            supplierId,
            day,
            branches: [...branchesInMatch],
            orderNumbers: matchingOrders.map((o) => o.orderNumber),
            lineCount: matchingOrders[0].lines.length,
          });
        }
      }
    }
  }

  console.log(JSON.stringify({
    windowDays: 60,
    totalOrdersScanned: orders.length,
    groupsWithExactRepetitionAcrossBranches: groupsWithRepetition,
    ordersInvolvedInRepetition: ordersInvolved,
    examples,
  }, null, 2));
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
