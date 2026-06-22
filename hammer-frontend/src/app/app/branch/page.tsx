"use client";

import { DispatchWorkspace } from "@/components/dispatch/dispatch-workspace";
import { useSession } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";

export default function BranchDispatchPage() {
  const sessionState = useSession();

  if (sessionState.status === "loading") {
    return <p className="text-[var(--color-text-muted)] animate-pulse">Cargando…</p>;
  }
  if (sessionState.status !== "authenticated") {
    return <p className="text-[var(--color-danger-600)]">Sesión no válida.</p>;
  }

  const branchId = getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId);
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
