"use client";

import { OrdersAdmin } from "@/components/sales/orders-admin";
import { useSession } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";

// prompt-historial-sucursal.md Fase 2.3 — mismo patrón que
// branch/sales/orders/page.tsx (mensajes de carga, sesión inválida y sin
// sucursal incluidos, sin encabezado propio: el header sticky de
// AppShellRouter ya trae el título — ver el caso "history" agregado en
// resolveHeaderMeta, app-shell-router.tsx). OrdersAdmin ya trae lista,
// filtros, detalle y devoluciones — reusada en mode="branch" en vez de
// construir una pantalla nueva desde cero.
export default function BranchSalesHistoryPage() {
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

  return <OrdersAdmin mode="branch" branchId={branchId} />;
}
