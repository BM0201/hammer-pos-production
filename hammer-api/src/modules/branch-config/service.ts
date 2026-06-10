import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";

export type BranchModuleConfigRow = {
  id: string;
  branchId: string;
  enableCashier: boolean;
  enableDispatch: boolean;
  paymentWorkflowMode: "QUEUE_ONLY" | "DIRECT_ONLY" | "HYBRID";
  dispatchWorkflowMode: "DISABLED" | "ENABLED";
  requireOpenCashSessionForDirectSale: boolean;
  allowSellerDirectPayment: boolean;
  allowCashierQueue: boolean;
  updatedAt: Date;
  branch: { id: string; code: string; name: string; isActive: boolean };
};

/**
 * Get module config for a single branch.
 * Returns direct-sale defaults if no config row exists.
 */
export async function getBranchModuleConfig(branchId: string): Promise<{
  enableCashier: boolean;
  enableDispatch: boolean;
  paymentWorkflowMode: "QUEUE_ONLY" | "DIRECT_ONLY" | "HYBRID";
  dispatchWorkflowMode: "DISABLED" | "ENABLED";
  requireOpenCashSessionForDirectSale: boolean;
  allowSellerDirectPayment: boolean;
  allowCashierQueue: boolean;
}> {
  const config = await prisma.branchModuleConfig.findUnique({ where: { branchId } });
  const enableCashier = config?.enableCashier ?? true;
  const enableDispatch = config?.enableDispatch ?? true;
  return {
    enableCashier,
    enableDispatch,
    paymentWorkflowMode: config?.paymentWorkflowMode ?? (enableCashier ? "HYBRID" : "DIRECT_ONLY"),
    dispatchWorkflowMode: config?.dispatchWorkflowMode ?? (enableDispatch ? "ENABLED" : "DISABLED"),
    requireOpenCashSessionForDirectSale: config?.requireOpenCashSessionForDirectSale ?? true,
    allowSellerDirectPayment: config?.allowSellerDirectPayment ?? true,
    allowCashierQueue: config?.allowCashierQueue ?? enableCashier,
  };
}

/** List all branches with their module configs */
export async function listBranchModuleConfigs(): Promise<BranchModuleConfigRow[]> {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    include: { moduleConfig: true },
    orderBy: { code: "asc" },
  });

  return branches.map((branch: any) => ({
    id: branch.moduleConfig?.id ?? "",
    branchId: branch.id,
    enableCashier: branch.moduleConfig?.enableCashier ?? true,
    enableDispatch: branch.moduleConfig?.enableDispatch ?? true,
    paymentWorkflowMode: branch.moduleConfig?.paymentWorkflowMode ?? (branch.moduleConfig?.enableCashier === false ? "DIRECT_ONLY" : "HYBRID"),
    dispatchWorkflowMode: branch.moduleConfig?.dispatchWorkflowMode ?? (branch.moduleConfig?.enableDispatch === false ? "DISABLED" : "ENABLED"),
    requireOpenCashSessionForDirectSale: branch.moduleConfig?.requireOpenCashSessionForDirectSale ?? true,
    allowSellerDirectPayment: branch.moduleConfig?.allowSellerDirectPayment ?? true,
    allowCashierQueue: branch.moduleConfig?.allowCashierQueue ?? (branch.moduleConfig?.enableCashier ?? true),
    updatedAt: branch.moduleConfig?.updatedAt ?? branch.updatedAt,
    branch: { id: branch.id, code: branch.code, name: branch.name, isActive: branch.isActive },
  }));
}

/** Upsert module config for a branch */
export async function upsertBranchModuleConfig(input: {
  branchId: string;
  enableCashier: boolean;
  enableDispatch: boolean;
  paymentWorkflowMode?: "QUEUE_ONLY" | "DIRECT_ONLY" | "HYBRID";
  dispatchWorkflowMode?: "DISABLED" | "ENABLED";
  requireOpenCashSessionForDirectSale?: boolean;
  allowSellerDirectPayment?: boolean;
  allowCashierQueue?: boolean;
  actorUserId: string;
}) {
  const existing = await prisma.branchModuleConfig.findUnique({ where: { branchId: input.branchId } });
  const paymentWorkflowMode = input.paymentWorkflowMode ?? existing?.paymentWorkflowMode ?? (input.enableCashier ? "HYBRID" : "DIRECT_ONLY");
  const dispatchWorkflowMode = input.dispatchWorkflowMode ?? existing?.dispatchWorkflowMode ?? (input.enableDispatch ? "ENABLED" : "DISABLED");
  const requireOpenCashSessionForDirectSale = input.requireOpenCashSessionForDirectSale ?? existing?.requireOpenCashSessionForDirectSale ?? true;
  const allowSellerDirectPayment = input.allowSellerDirectPayment ?? existing?.allowSellerDirectPayment ?? true;
  const allowCashierQueue = input.allowCashierQueue ?? existing?.allowCashierQueue ?? input.enableCashier;
  const result = await prisma.branchModuleConfig.upsert({
    where: { branchId: input.branchId },
    update: {
      enableCashier: input.enableCashier,
      enableDispatch: input.enableDispatch,
      paymentWorkflowMode,
      dispatchWorkflowMode,
      requireOpenCashSessionForDirectSale,
      allowSellerDirectPayment,
      allowCashierQueue,
      updatedByUserId: input.actorUserId,
    },
    create: {
      branchId: input.branchId,
      enableCashier: input.enableCashier,
      enableDispatch: input.enableDispatch,
      paymentWorkflowMode,
      dispatchWorkflowMode,
      requireOpenCashSessionForDirectSale,
      allowSellerDirectPayment,
      allowCashierQueue,
      updatedByUserId: input.actorUserId,
    },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "branch-config",
    action: "MODULE_CONFIG_UPDATED",
    entityType: "BranchModuleConfig",
    entityId: result.id,
    metadataJson: {
      enableCashier: input.enableCashier,
      enableDispatch: input.enableDispatch,
      paymentWorkflowMode,
      dispatchWorkflowMode,
      requireOpenCashSessionForDirectSale,
      allowSellerDirectPayment,
      allowCashierQueue,
    },
  });

  return result;
}

/** Bulk update module config for multiple branches */
export async function bulkUpdateBranchModuleConfigs(input: {
  branchIds: string[];
  enableCashier: boolean;
  enableDispatch: boolean;
  actorUserId: string;
}) {
  const results = [];
  for (const branchId of input.branchIds) {
    const result = await upsertBranchModuleConfig({
      branchId,
      enableCashier: input.enableCashier,
      enableDispatch: input.enableDispatch,
      actorUserId: input.actorUserId,
    });
    results.push(result);
  }
  return results;
}

/**
 * Determines the workflow description for a branch config.
 */
export function describeWorkflow(enableCashier: boolean, enableDispatch: boolean): string {
  if (enableCashier && enableDispatch) return "Hibrido: Venta directa o Venta -> Caja -> Despacho";
  if (enableCashier && !enableDispatch) return "Sin despacho: Venta -> Caja -> Entregado";
  if (!enableCashier && enableDispatch) return "Sin caja: Venta+Cobro -> Despacho";
  return "Directo: Venta+Cobro+Entrega";
}
