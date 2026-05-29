"use client";

import { OperationalDayPanel } from "@/components/operations/operational-day-panel";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { useSession } from "@/lib/client/session";

export default function BranchOperationsPage() {
  const sessionState = useSession();

  if (sessionState.status === "loading") return <p className="text-[var(--color-text-muted)] animate-pulse">Cargando...</p>;
  if (sessionState.status !== "authenticated") return <p className="text-[var(--color-danger-600)]">Sesion no valida.</p>;

  const branchId = getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId);
  if (!branchId) return <p className="text-[var(--color-danger-600)]">No tienes una sucursal asignada.</p>;

  return <OperationalDayPanel branchId={branchId} />;
}
