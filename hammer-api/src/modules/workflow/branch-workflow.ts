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

  if (config.enableCashier) {
    allowed.push(WORKFLOW_ACTIONS.SUBMIT_TO_CASHIER, WORKFLOW_ACTIONS.COLLECT_PAYMENT, WORKFLOW_ACTIONS.VIEW_CASHIER);
    blocked.push(WORKFLOW_ACTIONS.DIRECT_SALE);
  } else {
    allowed.push(WORKFLOW_ACTIONS.DIRECT_SALE);
    blocked.push(WORKFLOW_ACTIONS.SUBMIT_TO_CASHIER, WORKFLOW_ACTIONS.COLLECT_PAYMENT, WORKFLOW_ACTIONS.VIEW_CASHIER);
  }

  if (config.enableDispatch) {
    allowed.push(WORKFLOW_ACTIONS.VIEW_DISPATCH, WORKFLOW_ACTIONS.MARK_DISPATCHED, WORKFLOW_ACTIONS.CREATE_TRANSPORT, WORKFLOW_ACTIONS.UPDATE_TRANSPORT_STATUS);
  } else {
    blocked.push(WORKFLOW_ACTIONS.MARK_DISPATCHED, WORKFLOW_ACTIONS.CREATE_TRANSPORT, WORKFLOW_ACTIONS.UPDATE_TRANSPORT_STATUS);
  }

  let description: string;
  if (config.enableCashier && config.enableDispatch) {
    description = "Completo: Venta -> Caja -> Despacho";
  } else if (config.enableCashier && !config.enableDispatch) {
    description = "Sin despacho: Venta -> Caja -> Entregado";
  } else if (!config.enableCashier && config.enableDispatch) {
    description = "Sin caja: Venta+Cobro -> Despacho";
  } else {
    description = "Directo: Venta+Cobro+Entrega";
  }

  return {
    enableCashier: config.enableCashier,
    enableDispatch: config.enableDispatch,
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
    case WORKFLOW_ACTIONS.COLLECT_PAYMENT:
    case WORKFLOW_ACTIONS.VIEW_CASHIER:
      if (!config.enableCashier) {
        throw new Error("CASHIER_MODULE_DISABLED");
      }
      break;

    case WORKFLOW_ACTIONS.DIRECT_SALE:
      if (config.enableCashier) {
        throw new Error("CASHIER_MODULE_ENABLED");
      }
      break;

    case WORKFLOW_ACTIONS.MARK_DISPATCHED:
    case WORKFLOW_ACTIONS.CREATE_TRANSPORT:
    case WORKFLOW_ACTIONS.UPDATE_TRANSPORT_STATUS:
      if (!config.enableDispatch) {
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
