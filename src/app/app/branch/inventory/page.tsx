import { requireCapabilityInAnyAssignedBranch, requireSession } from "@/modules/auth/guards";
import { InventoryAdmin } from "@/components/inventory/inventory-admin";
import { CAPABILITIES, canInBranch } from "@/modules/rbac/policies";
import { prisma } from "@/lib/prisma";

export default async function BranchInventoryPage() {
  await requireCapabilityInAnyAssignedBranch(CAPABILITIES.BRANCH_INVENTORY_VIEW);
  const session = await requireSession();
  const branchId = session.branchIds[0];

  if (!branchId) {
    return <p className="text-[var(--color-danger-600)]">No tienes una sucursal asignada.</p>;
  }

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true, code: true, name: true },
  });

  if (!branch) {
    return <p className="text-[var(--color-danger-600)]">Tu sucursal asignada no existe o fue deshabilitada.</p>;
  }

  const canPostManualMovements = canInBranch(session, branch.id, CAPABILITIES.INVENTORY_MOVEMENT_POST);

  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div
            className="h-8 w-1 rounded-full"
            style={{
              background: "linear-gradient(to bottom, var(--color-warehouse-400), var(--color-warehouse-600))",
            }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Inventario de Sucursal</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Operaciones restringidas a tu sucursal autorizada</p>
          </div>
        </div>
      </div>
      <InventoryAdmin branchId={branch.id} branchCode={branch.code} branchName={branch.name} canPostManualMovements={canPostManualMovements} />
    </section>
  );
}
