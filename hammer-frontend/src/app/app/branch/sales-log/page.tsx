"use client";

import { SalesLog } from "@/components/branch/sales-log/sales-log";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { useSession } from "@/lib/client/session";

export default function BranchSalesLogPage() {
  const sessionState = useSession();

  if (sessionState.status === "loading") {
    return <p className="text-[var(--color-text-muted)] animate-pulse">Cargando...</p>;
  }
  if (sessionState.status !== "authenticated") {
    return <p className="text-[var(--color-danger-600)]">Sesion no valida.</p>;
  }

  const branchId = getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId);
  if (!branchId) {
    return <p className="text-[var(--color-danger-600)]">No tienes una sucursal asignada.</p>;
  }

  return (
    <section className="space-y-6 animate-fade-in-up">
      <SalesLog branchId={branchId} />
    </section>
  );
}
