/**
 * ════════════════════════════════════════════════════════════════
 * BRANCH WORKFLOW GUARD
 *
 * Central guard for BranchModuleConfig-driven workflow actions.
 * Controls which operations are allowed based on enableCashier/enableDispatch.
 * ════════════════════════════════════════════════════════════════
 */

import { getBranchModuleConfig } from "@/modules/branch-config/service";
import type { SessionPayload } from "@/types/auth";
import { canUseBranchCapability } from "@/modules/rbac/effective-permissions";
import type { Capability } from "@/modules/rbac/policies";

export const WORKFLOW_ACTIONS = {
  CREATE_DRAFT_ORDER: "CREATE_DRAFT_ORDER",
  SUBMIT_TO_CASHIER: "SUBMIT_TO_CASHIER",
  DIRECT_SALE: "DIRECT_SALE",
  COLLECT_PAYMENT: "COLLECT_PAYMENT",
  VIEW_CASHIER: "VIEW_CASHIER",
  VIEW_DISPATCH: "VIEW_DISPATCH",
  MARK_DISPATCHED: "MARK_DISPATCHED",
  CREATE_TRANSPORT: "CREATE_TRANSPORT",
  UPDATE_TRANSPORT_STATUS: "UPDATE_TRANSPORT_STATUS",
} as const;

export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[keyof typeof WORKFLOW_ACTIONS];

export type BranchWorkflowConfig = {
  enableCashier: boolean;
  enableDispatch: boolean;
  paymentWorkflowMode: "QUEUE_ONLY" | "DIRECT_ONLY" | "HYBRID";
  dispatchWorkflowMode: "DISABLED" | "ENABLED";
  requireOpenCashSessionForDirectSale: boolean;
  allowSellerDirectPayment: boolean;
  allowCashierQueue: boolean;
  allowedActions: WorkflowAction[];
  blockedActions: WorkflowAction[];
  workflowDescription: string;
};

/**
 * Get the full workflow config for a branch, including which actions are allowed/blocked.
 */
export async function getBranchWorkflowConfig(branchId: string): Promise<BranchWorkflowConfig> {
  const config = await getBranchModuleConfig(branchId);

  const allowed: WorkflowAction[] = [WORKFLOW_ACTIONS.CREATE_DRAFT_ORDER];
  const blocked: WorkflowAction[] = [];

  if (config.paymentWorkflowMode === "QUEUE_ONLY") {
    allowed.push(WORKFLOW_ACTIONS.SUBMIT_TO_CASHIER, WORKFLOW_ACTIONS.COLLECT_PAYMENT, WORKFLOW_ACTIONS.VIEW_CASHIER);
    blocked.push(WORKFLOW_ACTIONS.DIRECT_SALE);
  } else if (config.paymentWorkflowMode === "DIRECT_ONLY") {
    allowed.push(WORKFLOW_ACTIONS.DIRECT_SALE);
    blocked.push(WORKFLOW_ACTIONS.SUBMIT_TO_CASHIER, WORKFLOW_ACTIONS.COLLECT_PAYMENT, WORKFLOW_ACTIONS.VIEW_CASHIER);
  } else {
    allowed.push(WORKFLOW_ACTIONS.SUBMIT_TO_CASHIER, WORKFLOW_ACTIONS.DIRECT_SALE, WORKFLOW_ACTIONS.COLLECT_PAYMENT, WORKFLOW_ACTIONS.VIEW_CASHIER);
  }

  if (config.dispatchWorkflowMode === "ENABLED") {
    allowed.push(WORKFLOW_ACTIONS.VIEW_DISPATCH, WORKFLOW_ACTIONS.MARK_DISPATCHED, WORKFLOW_ACTIONS.CREATE_TRANSPORT, WORKFLOW_ACTIONS.UPDATE_TRANSPORT_STATUS);
  } else {
    blocked.push(WORKFLOW_ACTIONS.MARK_DISPATCHED, WORKFLOW_ACTIONS.CREATE_TRANSPORT, WORKFLOW_ACTIONS.UPDATE_TRANSPORT_STATUS);
  }

  const paymentLabel = config.paymentWorkflowMode === "HYBRID"
    ? "Hibrido: venta directa y cola de caja"
    : config.paymentWorkflowMode === "QUEUE_ONLY"
      ? "Solo cola de caja"
      : "Solo cobro directo";
  const description = config.dispatchWorkflowMode === "ENABLED"
    ? `${paymentLabel} -> Despacho`
    : `${paymentLabel} -> Entrega directa`;

  return {
    enableCashier: config.enableCashier,
    enableDispatch: config.enableDispatch,
    paymentWorkflowMode: config.paymentWorkflowMode,
    dispatchWorkflowMode: config.dispatchWorkflowMode,
    requireOpenCashSessionForDirectSale: config.requireOpenCashSessionForDirectSale,
    allowSellerDirectPayment: config.allowSellerDirectPayment,
    allowCashierQueue: config.allowCashierQueue,
    allowedActions: allowed,
    blockedActions: blocked,
    workflowDescription: description,
  };
}

/**
 * Assert a workflow action is allowed for the given branch.
 * Throws descriptive error codes that map to API errors.
 */
export async function assertBranchWorkflowAction(
  branchId: string,
  action: WorkflowAction,
): Promise<void> {
  const config = await getBranchModuleConfig(branchId);

  switch (action) {
    case WORKFLOW_ACTIONS.SUBMIT_TO_CASHIER:
    case WORKFLOW_ACTIONS.VIEW_CASHIER:
      if (config.paymentWorkflowMode === "DIRECT_ONLY" || !config.allowCashierQueue) {
        throw new Error("CASHIER_MODULE_DISABLED");
      }
      break;

    case WORKFLOW_ACTIONS.COLLECT_PAYMENT:
      if (config.paymentWorkflowMode === "DIRECT_ONLY" && !config.allowCashierQueue) {
        throw new Error("CASHIER_MODULE_DISABLED");
      }
      break;

    case WORKFLOW_ACTIONS.DIRECT_SALE:
      if (config.paymentWorkflowMode === "QUEUE_ONLY" || !config.allowSellerDirectPayment) {
        throw new Error("DIRECT_PAYMENT_DISABLED");
      }
      break;

    case WORKFLOW_ACTIONS.MARK_DISPATCHED:
    case WORKFLOW_ACTIONS.CREATE_TRANSPORT:
    case WORKFLOW_ACTIONS.UPDATE_TRANSPORT_STATUS:
      if (config.dispatchWorkflowMode === "DISABLED") {
        throw new Error("DISPATCH_MODULE_DISABLED");
      }
      break;

    case WORKFLOW_ACTIONS.VIEW_DISPATCH:
      // View dispatch is always allowed (can show historical data)
      break;

    case WORKFLOW_ACTIONS.CREATE_DRAFT_ORDER:
      // Always allowed
      break;
  }
}

/**
 * Combined guard: check both workflow action AND RBAC capability.
 */
export async function requireBranchWorkflowCapability(
  session: SessionPayload | null,
  branchId: string,
  action: WorkflowAction,
  capability: Capability,
): Promise<void> {
  if (!session) throw new Error("UNAUTHENTICATED");

  // First check capability (RBAC)
  if (!canUseBranchCapability(session, branchId, capability)) {
    throw new Error("FORBIDDEN_CAPABILITY");
  }

  // Then check workflow action (module config)
  await assertBranchWorkflowAction(branchId, action);
}
