"use client";

import { BranchPos } from "@/components/pos/branch-pos";
import { useSession } from "@/lib/client/session";

export default function BranchSalesOrdersPage() {
  const sessionState = useSession();

  if (sessionState.status === "loading") {
    return <p className="text-[var(--color-text-muted)] animate-pulse">Cargando…</p>;
  }
  if (sessionState.status !== "authenticated") {
    return <p className="text-[var(--color-danger-600)]">Sesión no válida.</p>;
  }

  const branchId = sessionState.session.branchIds[0];
  if (!branchId) {
    return <p className="text-[var(--color-danger-600)]">No tienes una sucursal asignada.</p>;
  }

  return (
    <section>
      <BranchPos branchId={branchId} />
    </section>
  );
}
