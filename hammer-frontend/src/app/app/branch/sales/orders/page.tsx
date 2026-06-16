"use client";

import { BranchPos } from "@/components/pos/branch-pos";
import { useSession } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";

// NOTE: This page only renders POS content. The unified app shell
// (dark role-themed sidebar + header + breadcrumbs) is provided once by
// <AppShellRouter> in app/layout.tsx for every route, including POS.
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
