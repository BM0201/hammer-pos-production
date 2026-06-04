"use client";

import { BranchPos } from "@/components/pos/branch-pos";
import { useSession } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";

// NOTE: This page intentionally does NOT render <PosShellWrapper>.
// The POS shell (sidebar + topbar) is provided once by <AppShellRouter>
// in app/layout.tsx for all POS routes (sales/orders, cashier/payments).
// Rendering PosShellWrapper here too caused the "double sidebar" bug.
// This mirrors the cashier/payments page, which also only renders content.
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

  return <BranchPos branchId={branchId} />;
}
