"use client";

import { CashSessionPanel } from "@/components/cash-session/cash-session-panel";
import { useSession } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";

/**
 * FASE 3 (UX): pantalla "Caja".
 * Solo se encarga del control de la sesión de caja física:
 * abrir, conciliar y cerrar la caja del día. La cola de cobro de
 * órdenes vive en una pantalla separada ("Cobros").
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
    <section className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-[var(--color-text)]">Caja</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Abre, concilia y cierra la sesión de la caja física. Para cobrar órdenes usa la pantalla <strong>Cobros</strong>.
        </p>
      </div>
      <CashSessionPanel branchId={branchId} />
    </section>
  );
}
