/**
 * Corrección de costos INFLADOS por el "bug de unidad de fusión".
 *
 * QUÉ ARREGLA
 *   Cuando en un ajuste/carga de inventario se digita el costo del PAQUETE
 *   (p. ej. un HIERRO = 14 varillas, una PALADA/METRO de arena, etc.) como si
 *   fuera el costo de la UNIDAD BASE (la varilla, la lata), el costo promedio
 *   ponderado (WAC) del canónico queda inflado ~factor veces. Ese WAC inflado
 *   se copia como snapshot en cada venta (InventoryMovement.unitCost) y hace que
 *   el Costo de Ventas (COGS) supere a las ventas → Finanzas "todo en negativo".
 *   (Ejemplo real en la base: "VARILLA DE 3/8 9V" con unitCost=1275 y un ajuste
 *   manual etiquetado por el propio usuario como "Bug al meter". Otro caso:
 *   "VARILLA DE 1/2 12V" con unitCost=1800 cuando lo correcto es ~236.)
 *
 * CÓMO DECIDE EL COSTO CORRECTO (data-driven, sin inventar cifras de negocio)
 *   La clave es que el costo del PAQUETE (el "HIERRO", el "METRO", etc.) SÍ está
 *   bien cargado y es muy consistente. Por eso la referencia contable correcta es:
 *
 *        costo_unidad_base = costo_del_paquete_hermano / factor_de_conversión
 *
 *   1. Para cada producto CANÓNICO de una fusión, toma el costo (limpio y
 *      consistente) de su producto-paquete hermano y lo divide por el factor.
 *      Ese es el costo por unidad base autoritativo (referencia por hermano).
 *   2. Si no hay hermano-paquete con costo limpio, usa la mediana recortada de
 *      los costos propios del producto (referencia por mediana) exigiendo al
 *      menos 2 observaciones reales.
 *   3. Marca como CORRUPTO todo unitCost/WAC >= MULT × referencia y lo reemplaza
 *      por la referencia. En ventas esto corrige directamente el COGS/Finanzas;
 *      en el WAC actual corrige las ventas FUTURAS.
 *
 *   NO toca cantidades. NO toca costos "bajos" (esos son otro caso —placeholders
 *   C$1 en productos sin costo cargado— y se listan aparte para revisión manual).
 *   Sólo corrige productos que son MIEMBROS de una fusión (clase de bug confirmada).
 *
 * SEGURIDAD
 *   - Por defecto corre en DRY-RUN (solo muestra, no escribe).
 *   - Con --apply escribe, pero primero vuelca un RESPALDO JSON de cada fila
 *     que va a cambiar (scripts/backups/fix-inflated-fusion-cost-<ts>.json).
 *   - Todas las escrituras van dentro de una transacción.
 *
 * USO
 *   npx tsx scripts/fix-inflated-fusion-cost.ts            # dry-run (recomendado primero)
 *   npx tsx scripts/fix-inflated-fusion-cost.ts --apply    # aplica de verdad (hace respaldo)
 *   Opcional: --mult=2.2 para ajustar el umbral de detección (default 2.2).
 */
import { prisma } from "@/lib/prisma";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SALE_OUT = ["SALE_OUT", "PACKAGE_SALE_OUT", "LOOSE_UNIT_SALE_OUT"];
const RETURN_IN = ["RETURN_IN", "LOOSE_UNIT_RETURN_IN"];

/** Umbral bajo el cual un "costo" se considera placeholder (sin costo real cargado). */
const PLACEHOLDER_MAX = 2;
/** Fuentes de snapshot que NO son confiables (placeholders del sistema). */
const UNRELIABLE_SNAP_SOURCES = new Set(["GLOBAL"]);

function n(v: unknown): number {
  return Number((v as { toString?: () => string })?.toString?.() ?? v ?? 0);
}
function money(v: number): string {
  return "C$" + (Math.round(v * 100) / 100).toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Costo "limpio" a partir de una lista de observaciones (costos de movimientos
 * y/o snapshots reales). Ignora placeholders <= C$2 y recorta outliers altos.
 * `clean` = hay al menos 2 observaciones reales y son consistentes entre sí
 * (max/min <= 1.6), señal de que ese costo es confiable.
 */
function cleanCost(costs: number[]): { value: number; clean: boolean; support: number } {
  const real = costs.filter((c) => c > PLACEHOLDER_MAX);
  if (real.length === 0) return { value: 0, clean: false, support: 0 };
  const m0 = median(real);
  const trimmed = real.filter((c) => c <= m0 * 1.5);
  const base = trimmed.length ? trimmed : real;
  const value = median(base);
  const mn = Math.min(...real), mx = Math.max(...real);
  const clean = real.length >= 2 && mn > 0 && mx / mn <= 1.6;
  return { value, clean, support: real.length };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const multArg = process.argv.find((a) => a.startsWith("--mult="));
  const MULT = multArg ? Number(multArg.split("=")[1]) : 2.2;

  console.log(`\n=== Corrección de costos inflados por bug de unidad de fusión ===`);
  console.log(`Modo: ${apply ? "APLICAR (escribe en la base)" : "DRY-RUN (solo simulación)"} | umbral MULT=${MULT}\n`);

  const branches = await prisma.branch.findMany({ select: { id: true, code: true } });
  const bc = new Map(branches.map((b) => [b.id, b.code]));

  // Todos los movimientos.
  const movements = await prisma.inventoryMovement.findMany({
    select: {
      id: true, productId: true, branchId: true, movementType: true,
      quantity: true, unitCost: true, createdAt: true, reason: true,
      product: { select: { sku: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Snapshots de costo y PRECIOS de líneas de venta.
  const saleLines = await prisma.saleOrderLine.findMany({
    select: { productId: true, costSnapshot: true, costSourceSnapshot: true, unitPrice: true },
  });
  // Precio de venta mediano por producto (para sanity check: el costo debe ir por debajo del precio).
  const priceObs = new Map<string, number[]>();
  for (const l of saleLines) {
    const up = n(l.unitPrice);
    if (up > 0) {
      if (!priceObs.has(l.productId)) priceObs.set(l.productId, []);
      priceObs.get(l.productId)!.push(up);
    }
  }
  const salePriceOf = (pid: string): number => median(priceObs.get(pid) ?? []);

  // Fusiones: sólo corregimos productos que son miembros de una fusión.
  const groups = await prisma.productStockGroup.findMany({
    include: { products: { select: { productId: true, isCanonical: true, conversionFactor: true } } },
  });
  const isFusion = new Set<string>();
  const groupInfo = new Map<string, { code: string; factor: number }>(); // para mostrar
  for (const g of groups) {
    for (const p of g.products) {
      isFusion.add(p.productId);
      if (!groupInfo.has(p.productId)) groupInfo.set(p.productId, { code: g.code, factor: n(p.conversionFactor) });
    }
  }

  // Observaciones de costo por producto: movimientos + snapshots confiables.
  const obsByProduct = new Map<string, number[]>();
  const pushObs = (pid: string, c: number) => {
    if (c > PLACEHOLDER_MAX) {
      if (!obsByProduct.has(pid)) obsByProduct.set(pid, []);
      obsByProduct.get(pid)!.push(c);
    }
  };
  for (const mv of movements) pushObs(mv.productId, n(mv.unitCost));
  for (const l of saleLines) {
    if (!l.costSourceSnapshot || !UNRELIABLE_SNAP_SOURCES.has(l.costSourceSnapshot)) pushObs(l.productId, n(l.costSnapshot));
  }

  // Referencia por HERMANO-PAQUETE: para cada producto canónico de una fusión,
  // costo por unidad base = costo (limpio) del hermano con mayor factor / factor.
  const siblingRefByProduct = new Map<string, { value: number; source: string }>();
  for (const g of groups) {
    const members = g.products.map((p) => ({ pid: p.productId, factor: n(p.conversionFactor) || 1, canon: p.isCanonical }));
    for (const canon of members.filter((m) => m.canon)) {
      const candidates: number[] = [];
      let src = "";
      for (const other of members) {
        if (other.pid === canon.pid) continue;
        const ratio = other.factor / canon.factor; // cuántas unidades base equivale el hermano
        if (ratio <= 1) continue; // sólo hermanos-PAQUETE (factor mayor)
        const sc = cleanCost(obsByProduct.get(other.pid) ?? []);
        if (sc.value > PLACEHOLDER_MAX && sc.clean) {
          candidates.push(sc.value / ratio);
          src = `${g.code}/${other.pid.slice(-6)}÷${ratio}`;
        }
      }
      if (candidates.length) {
        const val = median(candidates);
        const prev = siblingRefByProduct.get(canon.pid);
        // preferimos la referencia más baja y estable (evita arrastrar corrupción residual)
        if (!prev || val < prev.value) siblingRefByProduct.set(canon.pid, { value: val, source: src });
      }
    }
  }

  // Referencia final por producto: hermano-paquete (autoritativa) o mediana propia.
  function referenceFor(pid: string): { value: number; method: string } | null {
    const sib = siblingRefByProduct.get(pid);
    if (sib && sib.value > PLACEHOLDER_MAX) return { value: sib.value, method: "hermano" };
    const own = cleanCost(obsByProduct.get(pid) ?? []);
    if (own.value > PLACEHOLDER_MAX && own.support >= 2) return { value: own.value, method: "mediana" };
    return null;
  }

  const autoFixable = (pid: string, current: number): { to: number; method: string } | null => {
    if (!isFusion.has(pid)) return null;
    const ref = referenceFor(pid);
    if (!ref) return null;
    if (current < ref.value * MULT) return null;
    return { to: ref.value, method: ref.method };
  };
  // Sospechosos NO auto-corregibles (revisión manual): costo alto vs mediana propia
  // pero sin referencia confiable o fuera del alcance de fusión.
  const manualRef = (pid: string): number => cleanCost(obsByProduct.get(pid) ?? []).value;
  const manualReview = (pid: string, current: number): boolean => {
    if (autoFixable(pid, current)) return false;
    const r = manualRef(pid);
    return r > PLACEHOLDER_MAX && current >= r * MULT;
  };

  // 1) Movimientos con unitCost inflado.
  type MovFix = { id: string; pid: string; sku: string; name: string; branch: string; type: string; qty: number; from: number; to: number; isSale: boolean; fusion: string; method: string; reason: string | null; date: string };
  const movFixes: MovFix[] = [];
  const movReview: MovFix[] = [];
  for (const mv of movements) {
    const uc = n(mv.unitCost);
    const fix = autoFixable(mv.productId, uc);
    const gi = groupInfo.get(mv.productId);
    const rec: MovFix = {
      id: mv.id, pid: mv.productId, sku: mv.product.sku, name: mv.product.name, branch: bc.get(mv.branchId) ?? "—",
      type: mv.movementType, qty: n(mv.quantity), from: uc, to: fix?.to ?? manualRef(mv.productId),
      isSale: SALE_OUT.includes(mv.movementType) || RETURN_IN.includes(mv.movementType),
      fusion: gi ? `${gi.code}×${gi.factor}` : "no", method: fix?.method ?? "", reason: mv.reason, date: mv.createdAt.toISOString().slice(0, 10),
    };
    if (fix) movFixes.push(rec);
    else if (manualReview(mv.productId, uc)) movReview.push(rec);
  }

  // 2) Balances con WAC inflado hoy.
  const balances = await prisma.inventoryBalance.findMany({
    select: { id: true, productId: true, branchId: true, weightedAverageCost: true, quantityOnHand: true, product: { select: { sku: true, name: true } } },
  });
  type BalFix = { id: string; pid: string; sku: string; name: string; branch: string; from: number; to: number; qty: number; method: string };
  const balFixes: BalFix[] = [];
  const balReview: BalFix[] = [];
  for (const b of balances) {
    const w = n(b.weightedAverageCost);
    const fix = autoFixable(b.productId, w);
    const rec: BalFix = { id: b.id, pid: b.productId, sku: b.product.sku, name: b.product.name, branch: bc.get(b.branchId) ?? "—", from: w, to: fix?.to ?? manualRef(b.productId), qty: n(b.quantityOnHand), method: fix?.method ?? "" };
    if (fix) balFixes.push(rec);
    else if (manualReview(b.productId, w)) balReview.push(rec);
  }

  // ── Reporte ──────────────────────────────────────────────────────────
  movFixes.sort((a, b) => (b.from - b.to) * b.qty - (a.from - a.to) * a.qty);
  console.log(`Movimientos de FUSIÓN a corregir automáticamente: ${movFixes.length}`);
  console.log("fecha | suc | tipo | SKU | qty | costo actual → correcto | (venta?) | ref | motivo");
  let cogsRecovered = 0;
  const marginWarn = new Set<string>();
  for (const f of movFixes) {
    if (f.isSale && SALE_OUT.includes(f.type)) cogsRecovered += (f.from - f.to) * f.qty;
    const price = salePriceOf(f.pid);
    const warn = price > 0 && f.to >= price ? ` ⚠ costo≥precio(${money(price)})` : "";
    if (warn) marginWarn.add(`${f.sku} ${f.name.slice(0, 22)} (costo≈${money(f.to)} vs precio≈${money(price)})`);
    console.log(`${f.date} ${f.branch} ${f.type.padEnd(16)} ${f.sku.padEnd(18)} q=${String(f.qty).padStart(5)} ${money(f.from).padStart(11)} → ${money(f.to).padStart(9)} ${f.isSale ? "VENTA" : "     "} | ${f.method.padEnd(7)} | ${f.reason ?? ""}${warn}`);
  }
  console.log(`\nCOGS inflado que se recupera en ventas (impacto directo en Finanzas): ${money(cogsRecovered)}`);
  if (marginWarn.size) {
    console.log(`\n⚠ Productos cuyo costo corregido queda IGUAL o por ENCIMA del precio de venta (revisar precio o costo real):`);
    for (const w of marginWarn) console.log(`   - ${w}`);
  }

  balFixes.sort((a, b) => b.from - a.from);
  console.log(`\nBalances (WAC actual) de FUSIÓN a corregir automáticamente: ${balFixes.length}`);
  console.log("suc | SKU | nombre | WAC actual → correcto | stock | ref");
  for (const f of balFixes) {
    console.log(`${f.branch} ${f.sku.padEnd(18)} ${f.name.slice(0, 22).padEnd(22)} ${money(f.from).padStart(11)} → ${money(f.to).padStart(9)} | ${f.qty} | ${f.method}`);
  }

  // Sospechosos que NO se tocan (para que el usuario decida el costo correcto).
  if (movReview.length || balReview.length) {
    console.log(`\n⚠️  REVISIÓN MANUAL (NO se corrigen automáticamente — costo real desconocido o no es fusión):`);
    for (const f of movReview) {
      console.log(`   mov ${f.date} ${f.branch} ${f.type} ${f.sku} ${f.name.slice(0, 22)} q=${f.qty} costo=${money(f.from)} (aprox≈${money(f.to)}) ${f.isSale ? "VENTA" : ""}`);
    }
    for (const f of balReview) {
      console.log(`   WAC ${f.branch} ${f.sku} ${f.name.slice(0, 22)} = ${money(f.from)} (aprox≈${money(f.to)}) stock=${f.qty}`);
    }
    console.log("   → Suelen ser productos SIN costo real cargado (placeholder C$1) o ítems no-fusión.");
    console.log("     Definí el costo correcto de cada uno y cargalo por la vía normal de costos.");
  }

  if (!apply) {
    console.log(`\n(DRY-RUN) No se escribió nada. Revisá la lista; si está correcta, corré con --apply.`);
    await prisma.$disconnect();
    return;
  }

  // ── Aplicar (con respaldo) ───────────────────────────────────────────
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(process.cwd(), "scripts", "backups");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, `fix-inflated-fusion-cost-${ts}.json`);
  writeFileSync(backupPath, JSON.stringify({ movFixes, balFixes }, null, 2));
  console.log(`\nRespaldo escrito en: ${backupPath}`);

  let mv = 0, ba = 0;
  await prisma.$transaction(async (tx) => {
    for (const f of movFixes) {
      await tx.inventoryMovement.update({ where: { id: f.id }, data: { unitCost: f.to } });
      mv++;
    }
    for (const f of balFixes) {
      await tx.inventoryBalance.update({ where: { id: f.id }, data: { weightedAverageCost: f.to } });
      ba++;
    }
  });
  console.log(`\n✔️  Aplicado: ${mv} movimientos y ${ba} balances corregidos.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
