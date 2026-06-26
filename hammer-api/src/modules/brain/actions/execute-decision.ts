import { convertAlertToPurchaseOrder, convertAlertToTransfer } from "@/modules/reorder/service";
import { createPurchaseOrder } from "@/modules/purchase-orders/service";
import { createTransfer } from "@/modules/transfers/service";
import { prisma } from "@/lib/prisma";
import { syncCashSessionSnapshotTx } from "@/modules/cash-session/service";
import { refreshOperationalDaySummaryTx } from "@/modules/operations/service";

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
    // B: check idempotency first — a previous run may have created the PO but crashed before
    // updating BrainDecision status to EXECUTED, causing a retry that would double-create.
    const existingForAlert = await existingPurchaseOrder(input.idempotencyKey);
    if (existingForAlert) {
      return {
        executed: true,
        action,
        executedEntityType: "PurchaseOrder",
        executedEntityId: existingForAlert.id,
        orderNumber: existingForAlert.orderNumber,
        idempotent: true,
      };
    }
    const result = await convertAlertToPurchaseOrder(reorderAlertId, input.actorUserId);
    // Tag with idempotency key so the check above works on any future retry
    const currentPo = await prisma.purchaseOrder.findUnique({ where: { id: result.purchaseOrder.id }, select: { notes: true } }).catch(() => null);
    await prisma.purchaseOrder.update({
      where: { id: result.purchaseOrder.id },
      data: { notes: [currentPo?.notes, `Brain idempotency: ${input.idempotencyKey}`].filter(Boolean).join(" ") },
    }).catch(() => {});
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
    // B: same idempotency pattern for transfer conversions
    const existingForAlert = await existingTransfer(input.idempotencyKey);
    if (existingForAlert) {
      return {
        executed: true,
        action,
        executedEntityType: "Transfer",
        executedEntityId: existingForAlert.id,
        transferNumber: existingForAlert.transferNumber,
        idempotent: true,
      };
    }
    const result = await convertAlertToTransfer(reorderAlertId, input.actorUserId);
    const currentTx = await prisma.transfer.findUnique({ where: { id: result.transfer.id }, select: { notes: true } }).catch(() => null);
    await prisma.transfer.update({
      where: { id: result.transfer.id },
      data: { notes: [currentTx?.notes, `Brain idempotency: ${input.idempotencyKey}`].filter(Boolean).join(" ") },
    }).catch(() => {});
    return {
      executed: true,
      action,
      executedEntityType: "Transfer",
      executedEntityId: result.transfer.id,
      transferId: result.transfer.id,
      transferNumber: result.transfer.transferNumber,
    };
  }

  if (action === "RECALCULATE_CASH_SESSION") {
    const cashSessionId = stringValue(payload.cashSessionId ?? asRecord(payload.target).entityId);
    if (!cashSessionId) return { executed: false, action, message: "Falta cashSessionId para recalcular caja." };
    const before = await prisma.cashSession.findUnique({
      where: { id: cashSessionId },
      select: { expectedCashAmount: true, differenceAmount: true },
    });
    const snapshot = await prisma.$transaction((tx) => syncCashSessionSnapshotTx(tx, cashSessionId));
    const after = await prisma.cashSession.findUnique({
      where: { id: cashSessionId },
      select: { expectedCashAmount: true, differenceAmount: true },
    });
    return {
      executed: true,
      action,
      executedEntityType: "CashSession",
      executedEntityId: cashSessionId,
      before: {
        expectedCashAmount: before?.expectedCashAmount?.toString() ?? null,
        differenceAmount: before?.differenceAmount?.toString() ?? null,
      },
      after: {
        expectedCashAmount: after?.expectedCashAmount?.toString() ?? null,
        differenceAmount: after?.differenceAmount?.toString() ?? null,
      },
      snapshot,
    };
  }

  if (action === "REFRESH_OPERATIONAL_DAY") {
    const operationalDayId = stringValue(payload.operationalDayId ?? asRecord(payload.target).entityId);
    if (!operationalDayId) return { executed: false, action, message: "Falta operationalDayId para refrescar Dia Operativo." };
    const before = await prisma.operationalDay.findUnique({
      where: { id: operationalDayId },
      select: { salesTotal: true, pendingPaymentTotal: true, autoClosedPendingReviewCount: true, summaryJson: true },
    });
    const after = await prisma.$transaction((tx) => refreshOperationalDaySummaryTx(tx, operationalDayId));
    return {
      executed: true,
      action,
      executedEntityType: "OperationalDay",
      executedEntityId: operationalDayId,
      before: before ? {
        salesTotal: before.salesTotal.toString(),
        pendingPaymentTotal: before.pendingPaymentTotal.toString(),
        autoClosedPendingReviewCount: before.autoClosedPendingReviewCount,
      } : null,
      after: after ? {
        salesTotal: after.salesTotal.toString(),
        pendingPaymentTotal: after.pendingPaymentTotal.toString(),
        autoClosedPendingReviewCount: after.autoClosedPendingReviewCount,
      } : null,
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
    || action === "REPAIR_DRAFT_ORDER_TOTALS"
    || action === "BLOCK_ORDER_FOR_REVIEW"
    || action === "RECALCULATE_KARDEX_BALANCE"
    || action === "CREATE_INVENTORY_ADJUSTMENT_DRAFT"
    || action === "INVALIDATE_MANUAL_INVOICE"
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
