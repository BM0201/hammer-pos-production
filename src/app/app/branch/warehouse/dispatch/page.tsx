import { requireCapabilityInAnyAssignedBranch, requireSession } from "@/modules/auth/guards";
import { DispatchWorkspace } from "@/components/dispatch/dispatch-workspace";
import { CAPABILITIES } from "@/modules/rbac/policies";

export default async function BranchDispatchPage() {
  await requireCapabilityInAnyAssignedBranch(CAPABILITIES.DISPATCH_VIEW);
  const session = await requireSession();
  const branchId = session.branchIds[0];

  if (!branchId) {
    return <p className="text-[var(--color-danger-600)]">No tienes una sucursal asignada.</p>;
  }

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
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Despacho</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Cola operativa de órdenes pagadas pendientes de despacho</p>
          </div>
        </div>
      </div>
      <DispatchWorkspace branchId={branchId} />
    </section>
  );
}
