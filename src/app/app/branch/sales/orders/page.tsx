import { requireCapabilityInAnyAssignedBranch, requireSession } from "@/modules/auth/guards";
import { BranchPos } from "@/components/pos/branch-pos";
import { CAPABILITIES } from "@/modules/rbac/policies";

export default async function BranchSalesOrdersPage() {
  await requireCapabilityInAnyAssignedBranch(CAPABILITIES.SALES_VIEW);
  const session = await requireSession();
  const branchId = session.branchIds[0];

  if (!branchId) {
    return <p className="text-[var(--color-danger-600)]">No tienes una sucursal asignada.</p>;
  }

  return (
    <section>
      <BranchPos branchId={branchId} />
    </section>
  );
}
