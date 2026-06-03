"use client";

import { BranchPos } from "@/components/pos/branch-pos";
import { PosShellWrapper } from "@/components/pos/PosShellWrapper";
import { useSession } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";

export default function BranchSalesOrdersPage() {
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
    <PosShellWrapper
      username={sessionState.session.username}
      roleCode={sessionState.session.roleCode}
      branchId={branchId}
      branchName={`Sucursal ${branchId.slice(0, 6)}`}
      mode="sales"
      integrated
    >
      <BranchPos branchId={branchId} />
    </PosShellWrapper>
  );
}
