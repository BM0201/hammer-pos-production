import { requireCapabilityInAnyAssignedBranch, requireSession } from "@/modules/auth/guards";
import { CashierPayments } from "@/components/payments/cashier-payments";
import { CAPABILITIES } from "@/modules/rbac/policies";

export default async function BranchCashierPaymentsPage() {
  await requireCapabilityInAnyAssignedBranch(CAPABILITIES.CASH_PAYMENTS_VIEW);
  const session = await requireSession();
  const branchId = session.branchIds[0];

  if (!branchId) {
    return <p className="text-[var(--color-danger-600)]">No tienes una sucursal asignada.</p>;
  }

  return (
    <section>
      <CashierPayments branchId={branchId} />
    </section>
  );
}
