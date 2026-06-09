/**
 * ============================================================================
 *  AUDITORÍA DE INTEGRIDAD: MOVIMIENTOS DE VENTA vs ÓRDENES
 * ============================================================================
 *
 * OBJETIVO
 * --------
 * Garantizar el invariante de negocio:
 *
 *   "Todo descuento de inventario por venta (SALE_OUT con referenceType
 *    DIRECT_SALE | SALE_PAYMENT) debe corresponder a una SaleOrder VÁLIDA
 *    (existe, NO está anulada y NO es de prueba). Si la orden fue anulada o
 *    marcada como prueba, el inventario descontado DEBE haber sido revertido
 *    con movimientos RETURN_IN (SALE_REVERSAL | SALE_RESTORE) por la misma
 *    cantidad neta."
 *
 * El bug del 2026-06-09 (orden SO-MSY-MQ6VKAV0) violó este invariante: se
 * descontó inventario de 6 productos contra una orden anulada+prueba y NO se
 * revirtió, dejando la venta "fuera" de todos los totales pero el stock sí
 * descontado. Este script detecta esa clase de inconsistencias para que nunca
 * más pasen inadvertidas.
 *
 * QUÉ DETECTA (clasificación por severidad)
 * -----------------------------------------
 *   [HUÉRFANO]      SALE_OUT cuyo referenceId NO corresponde a ninguna SaleOrder.
 *   [VENTA-PERDIDA] SALE_OUT contra orden ANULADA o de PRUEBA cuyo inventario
 *                   NO fue revertido (neto descontado > 0). ← el bug.
 *   [DESCUADRE]     La cantidad de SALE_OUT no coincide con las líneas de la
 *                   orden (posible doble descuento o línea faltante).
 *
 * USO
 * ---
 *   # Auditar todo el histórico (sólo lectura, imprime reporte):
 *   DATABASE_URL="..." DIRECT_URL="..." npx tsx scripts/audit-orphan-sale-movements.ts
 *
 *   # Limitar a los últimos N días:
 *   ... npx tsx scripts/audit-orphan-sale-movements.ts --days=30
 *
 *   # Sólo una sucursal:
 *   ... npx tsx scripts/audit-orphan-sale-movements.ts --branch=<branchId>
 *
 *   # Volcar el resultado a JSON (para alertas / dashboards):
 *   ... npx tsx scripts/audit-orphan-sale-movements.ts --json > audit.json
 *
 * SALIDA / ALERTAS
 * ----------------
 * Sale con código de salida 0 si NO hay inconsistencias; 1 si encuentra alguna
 * (apto para CI/cron: un cron diario que falle dispara la alerta del equipo).
 *
 * Este detector es además reutilizable: la función `auditSaleMovements()` se
 * exporta para poder llamarla desde un endpoint de salud o un job programado.
 */
import { InventoryMovementType, PrismaClient } from "@prisma/client";

const SALE_OUT_REFERENCE_TYPES = ["DIRECT_SALE", "SALE_PAYMENT"];
const REVERSAL_REFERENCE_TYPES = ["SALE_REVERSAL", "SALE_RESTORE"];

export interface AuditFinding {
  severity: "HUERFANO" | "VENTA_PERDIDA" | "DESCUADRE";
  saleOrderId: string;
  orderNumber: string | null;
  branchId: string;
  message: string;
  saleOutQty: number;
  reversedQty: number;
  netOutstandingQty: number;
  orderStatus: string | null;
  isTest: boolean | null;
  voided: boolean;
}

export interface AuditResult {
  scannedMovements: number;
  scannedOrders: number;
  findings: AuditFinding[];
}

interface AuditOptions {
  prisma: PrismaClient;
  sinceDays?: number;
  branchId?: string;
}

/** Auditoría reutilizable (sólo lectura). Devuelve los hallazgos. */
export async function auditSaleMovements(opts: AuditOptions): Promise<AuditResult> {
  const { prisma, sinceDays, branchId } = opts;
  const createdAtFilter = sinceDays
    ? { gte: new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000) }
    : undefined;

  // 1. Traer todos los movimientos de venta (descuentos y reversas) en alcance.
  const movements = await prisma.inventoryMovement.findMany({
    where: {
      movementType: { in: [InventoryMovementType.SALE_OUT, InventoryMovementType.RETURN_IN] },
      referenceType: { in: [...SALE_OUT_REFERENCE_TYPES, ...REVERSAL_REFERENCE_TYPES] },
      ...(branchId ? { branchId } : {}),
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
    },
    select: {
      referenceId: true,
      referenceType: true,
      movementType: true,
      quantity: true,
      branchId: true,
      productId: true,
    },
  });

  // 2. Agrupar por orden (referenceId): cantidad descontada vs revertida.
  type Agg = { saleOut: number; reversed: number; branchId: string; productQty: Map<string, number> };
  const byOrder = new Map<string, Agg>();
  for (const m of movements) {
    const agg = byOrder.get(m.referenceId) ?? { saleOut: 0, reversed: 0, branchId: m.branchId, productQty: new Map() };
    const qty = Number(m.quantity);
    if (m.movementType === InventoryMovementType.SALE_OUT && SALE_OUT_REFERENCE_TYPES.includes(m.referenceType)) {
      agg.saleOut += qty;
      agg.productQty.set(m.productId, (agg.productQty.get(m.productId) ?? 0) + qty);
    } else if (m.movementType === InventoryMovementType.RETURN_IN && REVERSAL_REFERENCE_TYPES.includes(m.referenceType)) {
      agg.reversed += qty;
      agg.productQty.set(m.productId, (agg.productQty.get(m.productId) ?? 0) - qty);
    }
    byOrder.set(m.referenceId, agg);
  }

  // 3. Cargar las órdenes referenciadas.
  const orderIds = [...byOrder.keys()];
  const orders = await prisma.saleOrder.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true, orderNumber: true, status: true, isTest: true, voidedAt: true,
      lines: { select: { productId: true, quantity: true } },
    },
  });
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  const findings: AuditFinding[] = [];
  for (const [refId, agg] of byOrder) {
    const order = orderMap.get(refId);
    const net = agg.saleOut - agg.reversed;

    // [HUÉRFANO] El movimiento no apunta a ninguna orden.
    if (!order) {
      findings.push({
        severity: "HUERFANO",
        saleOrderId: refId,
        orderNumber: null,
        branchId: agg.branchId,
        message: `SALE_OUT (neto ${net}) sin SaleOrder asociada (referenceId fantasma).`,
        saleOutQty: agg.saleOut,
        reversedQty: agg.reversed,
        netOutstandingQty: net,
        orderStatus: null,
        isTest: null,
        voided: false,
      });
      continue;
    }

    const voided = order.voidedAt != null;

    // [VENTA-PERDIDA] Orden anulada/prueba con inventario neto aún descontado.
    if ((voided || order.isTest) && net > 0.0000001) {
      findings.push({
        severity: "VENTA_PERDIDA",
        saleOrderId: order.id,
        orderNumber: order.orderNumber,
        branchId: agg.branchId,
        message: `Orden ${voided ? "ANULADA" : ""}${voided && order.isTest ? "+" : ""}${order.isTest ? "PRUEBA" : ""} con ${net} unidades descontadas y NO revertidas. Revertir (RETURN_IN) o reactivar la venta.`,
        saleOutQty: agg.saleOut,
        reversedQty: agg.reversed,
        netOutstandingQty: net,
        orderStatus: order.status,
        isTest: order.isTest,
        voided,
      });
      continue;
    }

    // [DESCUADRE] La suma neta por producto no coincide con las líneas de la
    // orden válida (posible doble descuento o falta de línea).
    if (!voided && !order.isTest) {
      const lineQty = new Map<string, number>();
      for (const l of order.lines) lineQty.set(l.productId, (lineQty.get(l.productId) ?? 0) + Number(l.quantity));
      const mismatches: string[] = [];
      const productIds = new Set([...agg.productQty.keys(), ...lineQty.keys()]);
      for (const pid of productIds) {
        const moved = agg.productQty.get(pid) ?? 0;
        const expected = lineQty.get(pid) ?? 0;
        if (Math.abs(moved - expected) > 0.0000001) {
          mismatches.push(`producto ${pid}: inventario neto ${moved} vs línea ${expected}`);
        }
      }
      if (mismatches.length > 0) {
        findings.push({
          severity: "DESCUADRE",
          saleOrderId: order.id,
          orderNumber: order.orderNumber,
          branchId: agg.branchId,
          message: `Descuadre orden-inventario: ${mismatches.join("; ")}`,
          saleOutQty: agg.saleOut,
          reversedQty: agg.reversed,
          netOutstandingQty: net,
          orderStatus: order.status,
          isTest: order.isTest,
          voided,
        });
      }
    }
  }

  return { scannedMovements: movements.length, scannedOrders: orders.length, findings };
}

function parseArgs(argv: string[]) {
  const args = { days: undefined as number | undefined, branch: undefined as string | undefined, json: false };
  for (const raw of argv.slice(2)) {
    if (raw === "--json") args.json = true;
    else if (raw.startsWith("--days=")) args.days = Math.max(1, Number(raw.split("=")[1]) || 0) || undefined;
    else if (raw.startsWith("--branch=")) args.branch = raw.split("=")[1] || undefined;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const prisma = new PrismaClient();
  try {
    const result = await auditSaleMovements({ prisma, sinceDays: args.days, branchId: args.branch });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("========================================================================");
      console.log(" AUDITORÍA DE INTEGRIDAD VENTA ↔ INVENTARIO — H.A.M.M.E.R. POS");
      console.log(`   movimientos analizados: ${result.scannedMovements} | órdenes: ${result.scannedOrders}`);
      console.log("========================================================================");
      if (result.findings.length === 0) {
        console.log("\n✅ Sin inconsistencias. Todo SALE_OUT tiene una venta válida o fue revertido.");
      } else {
        console.log(`\n⚠ ${result.findings.length} hallazgo(s):\n`);
        for (const f of result.findings) {
          console.log(`  [${f.severity}] ${f.orderNumber ?? f.saleOrderId} (sucursal ${f.branchId})`);
          console.log(`     ${f.message}`);
          console.log(`     SALE_OUT=${f.saleOutQty}  revertido=${f.reversedQty}  neto=${f.netOutstandingQty}  status=${f.orderStatus ?? "—"} isTest=${f.isTest ?? "—"} anulada=${f.voided}\n`);
        }
      }
    }

    process.exitCode = result.findings.length > 0 ? 1 : 0;
  } catch (err) {
    console.error("❌ Error ejecutando la auditoría:", err);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar sólo si se invoca como script (no al importar la función reutilizable).
if (process.argv[1] && process.argv[1].includes("audit-orphan-sale-movements")) {
  main();
}
