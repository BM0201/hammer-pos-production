import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";

export type BranchModuleConfigRow = {
  id: string;
  branchId: string;
  enableCashier: boolean;
  enableDispatch: boolean;
  updatedAt: Date;
  branch: { id: string; code: string; name: string; isActive: boolean };
};

/**
 * Get module config for a single branch.
 * Returns direct-sale defaults if no config row exists.
 */
export async function getBranchModuleConfig(branchId: string): Promise<{ enableCashier: boolean; enableDispatch: boolean }> {
  const config = await prisma.branchModuleConfig.findUnique({ where: { branchId } });
  return {
    enableCashier: config?.enableCashier ?? false,
    enableDispatch: config?.enableDispatch ?? false,
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
    enableCashier: branch.moduleConfig?.enableCashier ?? false,
    enableDispatch: branch.moduleConfig?.enableDispatch ?? false,
    updatedAt: branch.moduleConfig?.updatedAt ?? branch.updatedAt,
    branch: { id: branch.id, code: branch.code, name: branch.name, isActive: branch.isActive },
  }));
}

/** Upsert module config for a branch */
export async function upsertBranchModuleConfig(input: {
  branchId: string;
  enableCashier: boolean;
  enableDispatch: boolean;
  actorUserId: string;
}) {
  const result = await prisma.branchModuleConfig.upsert({
    where: { branchId: input.branchId },
    update: {
      enableCashier: input.enableCashier,
      enableDispatch: input.enableDispatch,
      updatedByUserId: input.actorUserId,
    },
    create: {
      branchId: input.branchId,
      enableCashier: input.enableCashier,
      enableDispatch: input.enableDispatch,
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
  if (enableCashier && enableDispatch) return "Completo: Venta -> Caja -> Despacho";
  if (enableCashier && !enableDispatch) return "Sin despacho: Venta -> Caja -> Entregado";
  if (!enableCashier && enableDispatch) return "Sin caja: Venta+Cobro -> Despacho";
  return "Directo: Venta+Cobro+Entrega";
}
