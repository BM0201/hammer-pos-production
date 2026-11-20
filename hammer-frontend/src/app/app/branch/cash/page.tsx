"use client";

import { CashSessionPanel } from "@/components/cash-session/cash-session-panel";
import { useSession } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";

/**
 * Pantalla "Caja": la gaveta del turno (cuánto debe haber, salidas de dinero,
 * gastos de hoy y el cierre con conteo). Cobrar órdenes vive en "Cobros".
 */
export default function BranchCashPage() {
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
    <section className="flex flex-col gap-4 overflow-y-auto pb-4">
      <header>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Caja</h1>
        <p className="text-sm text-[var(--color-text-muted)]">La gaveta de tu turno. Para cobrar órdenes usa <strong>Cobros</strong>.</p>
      </header>
      <CashSessionPanel branchId={branchId} />
    </section>
  );
}
