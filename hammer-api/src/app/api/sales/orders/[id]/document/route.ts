/**
 * GET /api/sales/orders/[id]/document?type=DELIVERY_ORDER
 * Genera y retorna el HTML del documento para impresión.
 *
 * POST /api/sales/orders/[id]/document
 * Emite la orden de entrega (asigna número) y retorna el HTML.
 */
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertBranchAccess } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, validationFail } from "@/lib/api/response";
import {
  buildOrderDocumentData,
  getPrintSettingsForBranch,
  generateDocumentHtml,
  issueDeliveryOrder,
} from "@/modules/documents/document-service";
import { prisma } from "@/lib/prisma";
import type { DocumentType } from "@prisma/client";

type RouteParams = { params: Promise<{ id: string }> };

const VALID_TYPES: DocumentType[] = ["DELIVERY_ORDER", "PURCHASE_TICKET", "PAYMENT_RECEIPT", "PRODUCTION_ORDER"];

/**
 * GET — Obtener HTML del documento (sin emitir)
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { id } = await params;
    const url = new URL(request.url);
    const docType = (url.searchParams.get("type") ?? "DELIVERY_ORDER") as DocumentType;

    if (!VALID_TYPES.includes(docType)) {
      return validationFail({ type: "Tipo de documento inválido" });
    }

    const order = await prisma.saleOrder.findUniqueOrThrow({
      where: { id },
      select: { branchId: true },
    });

    assertBranchAccess(session!, order.branchId);

    const [orderData, settings] = await Promise.all([
      buildOrderDocumentData(id),
      getPrintSettingsForBranch(order.branchId),
    ]);

    const html = generateDocumentHtml(docType, { order: orderData, settings });

    return ok({ html, documentType: docType, orderNumber: orderData.orderNumber });
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}

/**
 * POST — Emitir orden de entrega (asignar número) y generar HTML
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await params;

    const order = await prisma.saleOrder.findUniqueOrThrow({
      where: { id },
      select: { branchId: true, status: true },
    });

    assertBranchAccess(session!, order.branchId);

    // Emitir número de orden de entrega
    const deliveryOrderNumber = await issueDeliveryOrder(id);

    // Generar HTML
    const [orderData, settings] = await Promise.all([
      buildOrderDocumentData(id),
      getPrintSettingsForBranch(order.branchId),
    ]);

    const html = generateDocumentHtml("DELIVERY_ORDER", { order: orderData, settings });

    return ok({
      html,
      deliveryOrderNumber,
      documentType: "DELIVERY_ORDER" as const,
      orderNumber: orderData.orderNumber,
    });
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
