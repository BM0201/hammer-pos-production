/**
 * Diagnóstico: "Finanzas & Contabilidad marca todo en negativo".
 *
 * SOLO LEE, no escribe nada. Reproduce EXACTAMENTE la aritmética de
 * modules/finance/service.ts → computeRealPerformance (Estado de resultados
 * real) y luego explica DE DÓNDE sale el signo negativo, con foco en el costo
 * de ventas (COGS) de las fusiones (arena, piedrín, hierro…).
 *
 * Contexto del bug:
 *   - La utilidad = ventas netas − COGS − gastos. El código de Finanzas es
 *     correcto: si sale negativo es porque el COGS (o los gastos) SUPERAN a las
 *     ventas cobradas del período.
 *   - El COGS de cada venta se graba como snapshot al momento de vender
 *     (InventoryMovement.unitCost = WAC base del canónico; SaleOrderLine
 *     .costSnapshot = costo efectivo por unidad de venta). Si el WAC del
 *     canónico de una fusión está INFLADO (p. ej. una camionada de arena cuyo
 *     costo se cargó por palada/camionada en vez de por lata), cada metro/lata
 *     vendido arrastra un COGS enorme → margen negativo aunque el precio de
 *     venta sea positivo. Es el mismo síntoma "invendible" ya documentado
 *     (precio < costo) pero visto desde Finanzas.
 *
 * Qué imprime:
 *   1. Estado de resultados por sucursal (igual que el panel de Finanzas).
 *   2. Las LÍNEAS de venta del período cuyo costo (costSnapshot × cantidad)
 *      es >= al ingreso de la línea (lineSubtotal) — las que meten el margen
 *      en rojo — agrupadas por producto, marcando si es miembro de fusión,
 *      su factor y el WAC actual del canónico. Ordenadas por "plata en riesgo".
 *
 * Uso:
 *   npx tsx scripts/diagnose-finance-negative.ts [YYYY-MM] [BRANCH_CODE]
 *   (sin args = mes actual, todas las sucursales)
 */
import { prisma } from "@/lib/prisma";

const SALE_OUT_TYPES = ["SALE_OUT", "PACKAGE_SALE_OUT", "LOOSE_UNIT_SALE_OUT"] as const;
const SELLABLE_RETURN_IN_TYPES = ["RETURN_IN", "LOOSE_UNIT_RETURN_IN"] as const;

function num(v: unknown): number {
  return Number((v as { toString?: () => string })?.toString?.() ?? v ?? 0);
}
function money(v: number): string {
  return `C$${(Math.round(v * 100) / 100).toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parsePeriod(arg?: string): { start: Date; end: Date; label: string } {
  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth(); // 0-based
  if (arg && /^\d{4}-\d{2}$/.test(arg)) {
    const [y, m] = arg.split("-").map(Number);
    year = y;
    month = m - 1;
  }
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0));
  const label = `${year}-${String(month + 1).padStart(2, "0")}`;
  return { start, end, label };
}

async function main() {
  const [, , periodArg, branchCodeArg] = process.argv;
  const { start, end, label } = parsePeriod(periodArg);

  const branches = await prisma.branch.findMany({ select: { id: true, code: true, name: true } });
  const branchById = new Map(branches.map((b) => [b.id, b]));
  const branch = branchCodeArg ? branches.find((b) => b.code === branchCodeArg) : null;
  if (branchCodeArg && !branch) {
    console.error(`Sucursal con código "${branchCodeArg}" no encontrada. Códigos: ${branches.map((b) => b.code).join(", ")}`);
    process.exit(1);
  }
  const branchId = branch?.id ?? null;
  const branchFilter = branchId ? { branchId } : {};

  console.log(`\n=== Diagnóstico de Finanzas — período ${label}${branch ? ` — sucursal ${branch.code}` : " — todas las sucursales"} ===\n`);

  // ── Mapa de fusiones: canónico y factor por miembro ──────────────────
  const groups = await prisma.productStockGroup.findMany({
    where: { isActive: true },
    include: { products: { where: { isActive: true }, select: { productId: true, isCanonical: true, conversionFactor: true } } },
  });
  const canonicalIdByMember = new Map<string, string>();
  const factorByMember = new Map<string, number>();
  const groupCodeByMember = new Map<string, string>();
  for (const g of groups) {
    const canonical = g.products.find((m) => m.isCanonical);
    if (!canonical) continue;
    for (const m of g.products) {
      canonicalIdByMember.set(m.productId, canonical.productId);
      factorByMember.set(m.productId, Number(m.conversionFactor));
      groupCodeByMember.set(m.productId, g.code);
    }
  }

  // ── 1) Estado de resultados real (mismo criterio que Finanzas) ───────
  const [payments, refunds, movements] = await Promise.all([
    prisma.payment.findMany({
      where: {
        paidAt: { gte: start, lt: end },
        status: "POSTED",
        ...(branchId ? { saleOrder: { branchId } } : {}),
      },
      select: { amount: true, saleOrder: { select: { branchId: true } } },
    }),
    prisma.refund.findMany({
      where: { ...branchFilter, status: "POSTED", postedAt: { gte: start, lt: end } },
      select: { amount: true, branchId: true },
    }),
    prisma.inventoryMovement.findMany({
      where: {
        ...branchFilter,
        movementType: { in: [...SALE_OUT_TYPES, ...SELLABLE_RETURN_IN_TYPES] },
        createdAt: { gte: start, lt: end },
      },
      select: { quantity: true, unitCost: true, movementType: true, branchId: true },
    }),
  ]);

  type Acc = { grossSales: number; refunds: number; cogsOut: number; cogsReturned: number };
  const per = new Map<string, Acc>();
  const acc = (id: string) => {
    let e = per.get(id);
    if (!e) { e = { grossSales: 0, refunds: 0, cogsOut: 0, cogsReturned: 0 }; per.set(id, e); }
    return e;
  };
  for (const p of payments) acc(p.saleOrder.branchId).grossSales += num(p.amount);
  for (const r of refunds) acc(r.branchId).refunds += num(r.amount);
  for (const m of movements) {
    const cost = num(m.quantity) * num(m.unitCost);
    if ((SALE_OUT_TYPES as readonly string[]).includes(m.movementType)) acc(m.branchId).cogsOut += cost;
    else acc(m.branchId).cogsReturned += cost;
  }

  let totNet = 0, totCogs = 0, totGP = 0;
  console.log("Estado de resultados (dinero real cobrado):");
  console.log("  Sucursal | Ventas netas |        COGS | Utilidad bruta | Margen");
  for (const [id, a] of per) {
    const netSales = a.grossSales - a.refunds;
    const cogs = a.cogsOut - a.cogsReturned;
    const gp = netSales - cogs;
    totNet += netSales; totCogs += cogs; totGP += gp;
    const bc = branchById.get(id)?.code ?? "—";
    const margin = netSales > 0 ? `${((gp / netSales) * 100).toFixed(1)}%` : "—";
    console.log(`  ${bc.padEnd(8)} | ${money(netSales).padStart(12)} | ${money(cogs).padStart(11)} | ${money(gp).padStart(14)} | ${margin.padStart(7)}`);
  }
  console.log(`  ${"TOTAL".padEnd(8)} | ${money(totNet).padStart(12)} | ${money(totCogs).padStart(11)} | ${money(totGP).padStart(14)} | ${totNet > 0 ? `${((totGP / totNet) * 100).toFixed(1)}%` : "—"}`);
  if (totGP < 0) {
    console.log(`\n  ⚠️  Utilidad bruta NEGATIVA: el COGS (${money(totCogs)}) supera las ventas netas (${money(totNet)}).`);
    console.log("     El cálculo de Finanzas es correcto; el problema está en el COSTO grabado de las ventas (ver abajo).");
  } else {
    console.log("\n  ✔️  La utilidad bruta del período NO es negativa con estos datos.");
    console.log("     Si el panel muestra rojo, revisá el sub-período/sucursal exactos o los gastos (planilla/caja).");
  }

  // ── 2) Líneas vendidas a/por debajo del costo (arrastran el margen) ──
  const lines = await prisma.saleOrderLine.findMany({
    where: {
      costSnapshot: { not: null },
      saleOrder: {
        ...(branchId ? { branchId } : {}),
        payments: { some: { status: "POSTED", paidAt: { gte: start, lt: end } } },
      },
    },
    select: {
      productId: true,
      quantity: true,
      lineSubtotal: true,
      costSnapshot: true,
      costSourceSnapshot: true,
      product: { select: { sku: true, name: true } },
      saleOrder: { select: { branchId: true } },
    },
  });

  type Off = {
    sku: string; name: string; qty: number; revenue: number; cogs: number;
    isFusion: boolean; groupCode: string | null; factor: number | null; costSource: string | null;
  };
  const offenders = new Map<string, Off>();
  for (const l of lines) {
    const qty = num(l.quantity);
    const revenue = num(l.lineSubtotal);
    const cogs = num(l.costSnapshot) * qty;
    if (cogs < revenue) continue; // solo las que dan margen <= 0
    const key = l.productId;
    let o = offenders.get(key);
    if (!o) {
      o = {
        sku: l.product.sku, name: l.product.name, qty: 0, revenue: 0, cogs: 0,
        isFusion: canonicalIdByMember.has(l.productId),
        groupCode: groupCodeByMember.get(l.productId) ?? null,
        factor: factorByMember.get(l.productId) ?? null,
        costSource: l.costSourceSnapshot,
      };
      offenders.set(key, o);
    }
    o.qty += qty; o.revenue += revenue; o.cogs += cogs;
  }

  const sorted = [...offenders.values()].sort((a, b) => (b.cogs - b.revenue) - (a.cogs - a.revenue));
  if (sorted.length === 0) {
    console.log("\nNo hay líneas vendidas a/por debajo del costo en el período. La negatividad (si existe) viene de gastos, no del costo de ventas.");
  } else {
    console.log(`\nProductos vendidos A/POR DEBAJO del costo (arrastran el margen a negativo) — ${sorted.length}:`);
    console.log("  Pérdida  | SKU / Producto | Cant | Ingreso | COGS | Fusión (grupo×factor) | Fuente costo");
    for (const o of sorted.slice(0, 40)) {
      const loss = o.cogs - o.revenue;
      const fusion = o.isFusion ? `SÍ (${o.groupCode}×${o.factor})` : "no";
      console.log(`  ${money(loss).padStart(12)} | ${o.sku} ${o.name.slice(0, 28)} | ${o.qty} | ${money(o.revenue)} | ${money(o.cogs)} | ${fusion} | ${o.costSource ?? "—"}`);
    }

    // WAC actual de los canónicos involucrados (para ver si está inflado)
    const canonicalIds = new Set<string>();
    for (const key of offenders.keys()) {
      const canon = canonicalIdByMember.get(key);
      if (canon) canonicalIds.add(canon);
    }
    if (canonicalIds.size > 0) {
      const canonBalances = await prisma.inventoryBalance.findMany({
        where: { productId: { in: [...canonicalIds] }, ...(branchId ? { branchId } : {}) },
        select: { productId: true, branchId: true, weightedAverageCost: true, quantityOnHand: true, product: { select: { sku: true, name: true } } },
      });
      console.log("\nWAC ACTUAL de los canónicos de fusión involucrados (¿inflado?):");
      console.log("  Sucursal | SKU canónico | Nombre | WAC/base | Stock base");
      for (const b of canonBalances) {
        const bc = branchById.get(b.branchId)?.code ?? "—";
        console.log(`  ${bc.padEnd(8)} | ${b.product.sku} | ${b.product.name.slice(0, 24)} | ${money(num(b.weightedAverageCost))} | ${num(b.quantityOnHand)}`);
      }
      console.log("\n  → Si el WAC/base de un canónico es desproporcionado frente al precio de venta de sus");
      console.log("    derivados, ese es el costo inflado. Corregí el costo del canónico (misma vía que los");
      console.log("    scripts fix-*-cost.ts / ajuste de inventario con costo correcto por unidad base).");
    }
  }

  console.log("");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
