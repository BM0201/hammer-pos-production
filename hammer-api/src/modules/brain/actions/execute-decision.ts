import { convertAlertToPurchaseOrder, convertAlertToTransfer } from "@/modules/reorder/service";
import { createPurchaseOrder } from "@/modules/purchase-orders/service";
import { createTransfer } from "@/modules/transfers/service";
import { prisma } from "@/lib/prisma";

type ExecuteInput = {
  decisionId: string;
  idempotencyKey: string;
  proposedActionType: string | null;
  proposedActionJson: unknown;
  actorUserId: string;
};

type ExecuteResult = {
  executed: boolean;
  action: string;
  executedEntityType?: string;
  executedEntityId?: string;
  message?: string;
  [key: string]: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function linePayload(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asRecord(item))
    .map((item) => ({
      productId: stringValue(item.productId),
      quantity: numberValue(item.quantity ?? item.suggestedQuantity, 0),
      unitCost: numberValue(item.unitCost, 0),
    }))
    .filter((line): line is { productId: string; quantity: number; unitCost: number } => Boolean(line.productId) && line.quantity > 0);
}

async function existingPurchaseOrder(idempotencyKey: string) {
  return prisma.purchaseOrder.findFirst({
    where: { notes: { contains: idempotencyKey } },
    select: { id: true, orderNumber: true },
  });
}

async function existingTransfer(idempotencyKey: string) {
  return prisma.transfer.findFirst({
    where: { notes: { contains: idempotencyKey } },
    select: { id: true, transferNumber: true },
  });
}

export async function executeDecisionAction(input: ExecuteInput): Promise<ExecuteResult> {
  const action = input.proposedActionType ?? "REVIEW_ONLY";
  const payload = asRecord(input.proposedActionJson);
  const reorderAlertId = stringValue(payload.reorderAlertId);

  if (action === "CREATE_PURCHASE_ORDER_DRAFT") {
    const existing = await existingPurchaseOrder(input.idempotencyKey);
    if (existing) {
      return {
        executed: true,
        action,
        executedEntityType: "PurchaseOrder",
        executedEntityId: existing.id,
        orderNumber: existing.orderNumber,
        idempotent: true,
      };
    }

    const branchId = stringValue(payload.branchId);
    const lines = linePayload(payload.lines);
    if (!branchId || lines.length === 0) {
      return { executed: false, action, message: "Faltan datos para crear pedido de compra; requiere revision manual." };
    }

    const po = await createPurchaseOrder({
      userId: input.actorUserId,
      branchId,
      supplier: stringValue(payload.supplier) ?? undefined,
      notes: `Creado desde Brain decision ${input.decisionId}. Idempotency: ${input.idempotencyKey}`,
      lines,
    });
    return {
      executed: true,
      action,
      executedEntityType: "PurchaseOrder",
      executedEntityId: po.id,
      purchaseOrderId: po.id,
      orderNumber: po.orderNumber,
    };
  }

  if (action === "CREATE_TRANSFER_DRAFT") {
    const existing = await existingTransfer(input.idempotencyKey);
    if (existing) {
      return {
        executed: true,
        action,
        executedEntityType: "Transfer",
        executedEntityId: existing.id,
        transferNumber: existing.transferNumber,
        idempotent: true,
      };
    }

    const fromBranchId = stringValue(payload.fromBranchId ?? payload.sourceBranchId);
    const toBranchId = stringValue(payload.toBranchId ?? payload.branchId);
    const lines = linePayload(payload.lines);
    if (!fromBranchId || !toBranchId || lines.length === 0) {
      return { executed: false, action, message: "Faltan datos para crear transferencia; requiere revision manual." };
    }

    const transfer = await createTransfer({
      userId: input.actorUserId,
      fromBranchId,
      toBranchId,
      notes: `Creado desde Brain decision ${input.decisionId}. Idempotency: ${input.idempotencyKey}`,
      lines: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
    });
    return {
      executed: true,
      action,
      executedEntityType: "Transfer",
      executedEntityId: transfer.id,
      transferId: transfer.id,
      transferNumber: transfer.transferNumber,
    };
  }

  if (action === "CONVERT_REORDER_ALERT_TO_PURCHASE" && reorderAlertId) {
    const result = await convertAlertToPurchaseOrder(reorderAlertId, input.actorUserId);
    return {
      executed: true,
      action,
      executedEntityType: "PurchaseOrder",
      executedEntityId: result.purchaseOrder.id,
      purchaseOrderId: result.purchaseOrder.id,
      orderNumber: result.purchaseOrder.orderNumber,
    };
  }

  if (action === "CONVERT_REORDER_ALERT_TO_TRANSFER" && reorderAlertId) {
    const result = await convertAlertToTransfer(reorderAlertId, input.actorUserId);
    return {
      executed: true,
      action,
      executedEntityType: "Transfer",
      executedEntityId: result.transfer.id,
      transferId: result.transfer.id,
      transferNumber: result.transfer.transferNumber,
    };
  }

  if (
    action === "CREATE_PRICE_CHANGE_PROPOSAL"
    || action === "CREATE_DISCOUNT_PROPOSAL"
    || action === "SEND_TO_PHYSICAL_COUNT"
    || action === "CREATE_AUDIT_CASE"
    || action === "REVIEW_CASH_SESSION"
    || action === "REQUIRE_CASH_REVIEW"
    || action === "REVIEW_ONLY"
  ) {
    return {
      executed: false,
      action,
      message: "Esta decision requiere revision manual; no se ejecuto una accion automatica.",
      proposedActionJson: payload,
    };
  }

  return {
    executed: false,
    action,
    message: "Accion no ejecutable por el motor actual; requiere revision manual.",
  };
}
