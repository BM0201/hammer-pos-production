/**
 * ============================================================================
 *  REPARACIÓN DE LA VENTA PERDIDA  (orden SO-MSY-MQ6VKAV0 / SO-MSY-MQ6YLRDS)
 * ============================================================================
 *
 * QUÉ PASÓ (resumen forense)
 * --------------------------
 * El 2026-06-09 en la sucursal Masaya (MSY) se cobró C$7,813 (CASH, pago POSTED
 * a las 18:14:29) y se descontó inventario de 6 productos, PERO sobre una orden
 * que había sido marcada como prueba (17:25) y anulada (17:31) minutos antes.
 * Como anular/marcar prueba NO cambia el `status` (la orden seguía en estado
 * cobrable) y las guardas sólo miraban `status`, el cobro se completó.
 *
 *   • Orden REAL cobrada (tiene las 6 líneas + pago POSTED + 6 SALE_OUT):
 *       id          = cmq6vkavc0027ky0425cab5r5
 *       orderNumber = SO-MSY-MQ6VKAV0-2BB7E181
 *       status=DISPATCHED, isTest=TRUE, voidedAt=2026-06-09T17:31:48Z
 *       grandTotal=7813, pago CASH POSTED C$7813
 *
 *   • Orden VACÍA que ve el usuario (cascarón, 0 líneas, nunca descontó nada):
 *       id          = cmq6ylre5004hjx04bnkwgqju
 *       orderNumber = SO-MSY-MQ6YLRDS-552D7AA2
 *       status=DRAFT, isTest=FALSE, voidedAt=NULL, total=0
 *       (creada 18:14:30, 1s después del cobro; se le agregaron y luego
 *        removieron 6 líneas en un reintento manual → quedó en 0)
 *
 * El inventario (6 SALE_OUT, referenceId=cmq6vkavc0027ky0425cab5r5) y el pago
 * (saleOrderId=cmq6vkavc0027ky0425cab5r5) apuntan a la orden REAL, NO al cascarón.
 *
 * ESTRATEGIA DE REPARACIÓN
 * ------------------------
 * Hay dos formas de dejar la contabilidad consistente. El script soporta ambas;
 * por defecto ejecuta la OPCIÓN A (la correcta desde el punto de vista contable
 * y la menos invasiva, porque NO mueve inventario ni pagos):
 *
 *   OPCIÓN A — REACTIVAR la orden real  (recomendada, --mode=reactivate)
 *     La venta SÍ ocurrió: hubo dinero (C$7,813) e inventario descontado. La
 *     orden cmq6vkavc ya tiene TODO correcto (6 líneas, total, pago, SALE_OUT);
 *     sólo está marcada como prueba/anulada. Se la "des-anula":
 *         isTest=false, voidedAt=null, voidedByUserId=null, voidReason=null
 *     Con eso la venta vuelve a contar en todos los reportes (que ya excluyen
 *     anuladas/prueba vía validSaleWhere) sin tocar inventario ni pagos.
 *     El cascarón vacío SO-MSY-MQ6YLRDS se deja como está (o se anula con
 *     --void-shell para que no confunda).
 *
 *   OPCIÓN B — RECONSTRUIR sobre el cascarón  (--mode=reconnect)
 *     Reconecta las 6 líneas al cascarón SO-MSY-MQ6YLRDS, recalcula totales,
 *     repunta el pago y los 6 SALE_OUT a ese id, y deja la orden en DISPATCHED.
 *     Es más invasiva (mueve FKs de Payment e InventoryMovement) y deja la orden
 *     real cmq6vkavc anulada. Úsala sólo si el negocio EXIGE conservar el número
 *     SO-MSY-MQ6YLRDS como la venta oficial.
 *
 * SEGURIDAD
 * ---------
 *   • DRY-RUN por defecto: NO escribe nada hasta pasar --commit.
 *   • Todo corre en UNA transacción (atómico: o todo o nada).
 *   • Idempotente: si la orden ya está reparada, no hace cambios.
 *   • Valida invariantes antes de escribir (6 líneas, total 7813, pago POSTED).
 *
 * USO
 * ---
 *   # Simulación opción A (no escribe):
 *   DATABASE_URL="..." DIRECT_URL="..." npx tsx scripts/repair-lost-sale-cmq6vkavc.ts
 *
 *   # Aplicar opción A (reactivar la venta real):
 *   ... npx tsx scripts/repair-lost-sale-cmq6vkavc.ts --commit
 *
 *   # Aplicar opción A y además anular el cascarón vacío:
 *   ... npx tsx scripts/repair-lost-sale-cmq6vkavc.ts --commit --void-shell
 *
 *   # Opción B (reconstruir sobre SO-MSY-MQ6YLRDS):
 *   ... npx tsx scripts/repair-lost-sale-cmq6vkavc.ts --mode=reconnect --commit
 *
 * NOTA: requiere DATABASE_URL/DIRECT_URL apuntando a la base de producción
 * (Neon). El equivalente en SQL puro está documentado en el reporte
 * /home/ubuntu/reparacion-completa/.
 */
import { Prisma, PrismaClient, SaleOrderStatus } from "@prisma/client";

const REAL_ORDER_ID = "cmq6vkavc0027ky0425cab5r5"; // SO-MSY-MQ6VKAV0-2BB7E181
const SHELL_ORDER_ID = "cmq6ylre5004hjx04bnkwgqju"; // SO-MSY-MQ6YLRDS-552D7AA2
const EXPECTED_TOTAL = 7813;
const EXPECTED_LINES = 6;

type Mode = "reactivate" | "reconnect";

function parseArgs(argv: string[]) {
  const args = { commit: false, mode: "reactivate" as Mode, voidShell: false };
  for (const raw of argv.slice(2)) {
    if (raw === "--commit") args.commit = true;
    else if (raw === "--void-shell") args.voidShell = true;
    else if (raw.startsWith("--mode=")) {
      const m = raw.split("=")[1];
      if (m === "reactivate" || m === "reconnect") args.mode = m;
      else throw new Error(`--mode inválido: ${m} (usa reactivate|reconnect)`);
    }
  }
  return args;
}

function log(msg: string) {
  console.log(msg);
}

async function reactivate(tx: Prisma.TransactionClient, dryRun: boolean, voidShell: boolean) {
  const order = await tx.saleOrder.findUnique({
    where: { id: REAL_ORDER_ID },
    include: { lines: true, payments: true },
  });
  if (!order) throw new Error(`No se encontró la orden real ${REAL_ORDER_ID}`);

  log(`\n── OPCIÓN A: REACTIVAR ${order.orderNumber} (${order.id}) ──`);
  log(`   estado actual: status=${order.status} isTest=${order.isTest} voidedAt=${order.voidedAt?.toISOString() ?? "null"}`);
  log(`   líneas=${order.lines.length} grandTotal=${order.grandTotal.toString()}`);
  log(`   pagos POSTED=${order.payments.filter((p) => p.status === "POSTED").map((p) => p.amount.toString()).join(", ") || "ninguno"}`);

  // Invariantes de seguridad.
  if (order.lines.length !== EXPECTED_LINES) {
    throw new Error(`Esperaba ${EXPECTED_LINES} líneas, hay ${order.lines.length}. Abortando.`);
  }
  const posted = order.payments.filter((p) => p.status === "POSTED");
  const postedTotal = posted.reduce((s, p) => s + Number(p.amount), 0);
  if (postedTotal !== EXPECTED_TOTAL) {
    throw new Error(`Esperaba pago POSTED total ${EXPECTED_TOTAL}, hay ${postedTotal}. Abortando.`);
  }

  if (!order.isTest && !order.voidedAt) {
    log("   ✓ La orden YA está activa (idempotente): no hay nada que reactivar.");
  } else if (dryRun) {
    log("   [DRY-RUN] Se haría: isTest=false, voidedAt=null, voidedByUserId=null, voidReason=null");
  } else {
    await tx.saleOrder.update({
      where: { id: REAL_ORDER_ID },
      data: { isTest: false, voidedAt: null, voidedByUserId: null, voidReason: null },
    });
    log("   ✓ Orden reactivada: la venta de C$7,813 vuelve a contar en reportes.");
  }

  if (voidShell) {
    const shell = await tx.saleOrder.findUnique({ where: { id: SHELL_ORDER_ID }, include: { lines: true } });
    if (!shell) {
      log(`   (cascarón ${SHELL_ORDER_ID} no encontrado; nada que anular)`);
    } else if (shell.lines.length > 0) {
      log(`   ⚠ El cascarón ${shell.orderNumber} tiene ${shell.lines.length} líneas; NO se anula automáticamente.`);
    } else if (shell.voidedAt) {
      log(`   ✓ El cascarón ${shell.orderNumber} ya está anulado (idempotente).`);
    } else if (dryRun) {
      log(`   [DRY-RUN] Se anularía el cascarón vacío ${shell.orderNumber}.`);
    } else {
      await tx.saleOrder.update({
        where: { id: SHELL_ORDER_ID },
        data: { voidedAt: new Date(), voidReason: "Cascarón vacío del reintento del 2026-06-09; venta real en SO-MSY-MQ6VKAV0." },
      });
      log(`   ✓ Cascarón vacío ${shell.orderNumber} anulado para evitar confusión.`);
    }
  }
}

async function reconnect(tx: Prisma.TransactionClient, dryRun: boolean) {
  const real = await tx.saleOrder.findUnique({
    where: { id: REAL_ORDER_ID },
    include: { lines: true, payments: true },
  });
  const shell = await tx.saleOrder.findUnique({
    where: { id: SHELL_ORDER_ID },
    include: { lines: true },
  });
  if (!real) throw new Error(`No se encontró la orden real ${REAL_ORDER_ID}`);
  if (!shell) throw new Error(`No se encontró el cascarón ${SHELL_ORDER_ID}`);

  log(`\n── OPCIÓN B: RECONSTRUIR sobre ${shell.orderNumber} (${shell.id}) ──`);
  log(`   origen ${real.orderNumber}: ${real.lines.length} líneas, total ${real.grandTotal.toString()}`);
  log(`   destino ${shell.orderNumber}: ${shell.lines.length} líneas actuales`);

  if (real.lines.length !== EXPECTED_LINES) {
    throw new Error(`La orden origen no tiene ${EXPECTED_LINES} líneas (${real.lines.length}). Abortando.`);
  }
  if (shell.lines.length > 0) {
    throw new Error(`El cascarón ya tiene ${shell.lines.length} líneas. Revisar manualmente. Abortando.`);
  }

  if (dryRun) {
    log("   [DRY-RUN] Se haría, en una sola transacción:");
    log(`     1. Copiar las ${EXPECTED_LINES} líneas de ${real.orderNumber} → ${shell.orderNumber}`);
    log(`     2. Copiar totales (subtotal/discount/tax/grandTotal=${real.grandTotal.toString()}) al cascarón`);
    log("     3. Repuntar Payment.saleOrderId → cascarón (pago POSTED C$7813)");
    log("     4. Repuntar InventoryMovement.referenceId (6 SALE_OUT) → cascarón");
    log("     5. status del cascarón → DISPATCHED; anular la orden origen");
    return;
  }

  // 1. Copiar líneas.
  for (const line of real.lines) {
    await tx.saleOrderLine.create({
      data: {
        saleOrderId: SHELL_ORDER_ID,
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        lineSubtotal: line.lineSubtotal,
      },
    });
  }
  // 2. Copiar totales y estado.
  await tx.saleOrder.update({
    where: { id: SHELL_ORDER_ID },
    data: {
      subtotal: real.subtotal,
      discountTotal: real.discountTotal,
      manualDiscountAmount: real.manualDiscountAmount,
      taxTotal: real.taxTotal,
      grandTotal: real.grandTotal,
      status: SaleOrderStatus.DISPATCHED,
      isTest: false,
      voidedAt: null,
      voidedByUserId: null,
      voidReason: null,
    },
  });
  // 3. Repuntar pagos.
  await tx.payment.updateMany({
    where: { saleOrderId: REAL_ORDER_ID },
    data: { saleOrderId: SHELL_ORDER_ID },
  });
  // 4. Repuntar movimientos de inventario.
  await tx.inventoryMovement.updateMany({
    where: { referenceId: REAL_ORDER_ID },
    data: { referenceId: SHELL_ORDER_ID },
  });
  // 5. Anular la orden origen (queda como duplicado vacío).
  await tx.saleOrder.update({
    where: { id: REAL_ORDER_ID },
    data: {
      status: SaleOrderStatus.CANCELLED,
      voidedAt: new Date(),
      voidReason: "Reconstruida sobre SO-MSY-MQ6YLRDS por reparación 2026-06-09.",
    },
  });
  log("   ✓ Reconstrucción completa sobre el cascarón.");
}

async function main() {
  const args = parseArgs(process.argv);
  const prisma = new PrismaClient();
  const dryRun = !args.commit;

  log("========================================================================");
  log(" REPARACIÓN VENTA PERDIDA — H.A.M.M.E.R. POS");
  log(`   modo=${args.mode}  ${dryRun ? "(DRY-RUN: no escribe)" : "(COMMIT: escribe)"}`);
  log("========================================================================");

  try {
    await prisma.$transaction(async (tx) => {
      if (args.mode === "reactivate") {
        await reactivate(tx, dryRun, args.voidShell);
      } else {
        await reconnect(tx, dryRun);
      }
      if (dryRun) {
        log("\n[DRY-RUN] Transacción revertida intencionalmente. Usa --commit para aplicar.");
        throw new DryRunRollback();
      }
    });
    log("\n✅ Reparación aplicada y confirmada.");
  } catch (err) {
    if (err instanceof DryRunRollback) {
      log("✅ Simulación terminada sin escribir nada.");
    } else {
      console.error("\n❌ Error (transacción revertida, sin cambios):", err);
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

class DryRunRollback extends Error {}

main();
