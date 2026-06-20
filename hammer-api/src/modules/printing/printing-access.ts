/**
 * Helpers de autorización para rutas de impresión.
 * Carga el recurso real desde la BD y verifica acceso de sucursal.
 * Lanza "FORBIDDEN: ..." si la sesión no tiene acceso.
 */

import { prisma } from "@/lib/prisma";
import { hasBranchAccess } from "@/modules/rbac/guards";
import type { SessionPayload } from "@/types/auth";

export async function requireSaleOrderPrintAccess(
  session: SessionPayload,
  saleOrderId: string,
): Promise<void> {
  const order = await prisma.saleOrder.findUnique({
    where: { id: saleOrderId },
    select: { branchId: true },
  });
  if (!order) throw new Error("NOT_FOUND: orden de venta no encontrada");
  if (!hasBranchAccess(session, order.branchId)) {
    throw new Error("FORBIDDEN: sin acceso a los documentos de esta sucursal");
  }
}

export async function requireTransferPrintAccess(
  session: SessionPayload,
  transferId: string,
): Promise<void> {
  const transfer = await prisma.transfer.findUnique({
    where: { id: transferId },
    select: { fromBranchId: true, toBranchId: true },
  });
  if (!transfer) throw new Error("NOT_FOUND: traslado no encontrado");
  // Acceso si el usuario pertenece a origen O destino
  if (!hasBranchAccess(session, transfer.fromBranchId) && !hasBranchAccess(session, transfer.toBranchId)) {
    throw new Error("FORBIDDEN: sin acceso a los documentos de este traslado");
  }
}

export async function requirePurchaseOrderPrintAccess(
  session: SessionPayload,
  purchaseOrderId: string,
): Promise<void> {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { branchId: true },
  });
  if (!po) throw new Error("NOT_FOUND: orden de compra no encontrada");
  if (!hasBranchAccess(session, po.branchId)) {
    throw new Error("FORBIDDEN: sin acceso a los documentos de esta sucursal");
  }
}
