"use client";

import { OperationalDayPanel } from "@/components/operations/operational-day-panel";
import { LoadingState } from "@/components/ui/loading-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ShieldAlert } from "lucide-react";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { useSession } from "@/lib/client/session";

export default function BranchOperationsPage() {
  const sessionState = useSession();

  if (sessionState.status === "loading") {
    return <LoadingState message="Cargando sesión..." />;
  }

  if (sessionState.status !== "authenticated") {
    return (
      <EmptyState
        icon={<ShieldAlert className="h-full w-full" />}
        title="Sesión no válida"
        description="Tu sesión no pudo verificarse. Intenta iniciar sesión de nuevo."
        tone="warning"
      />
    );
  }

  const branchId = getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId);

  if (!branchId) {
    return (
      <EmptyState
        icon={<ShieldAlert className="h-full w-full" />}
        title="Sin sucursal asignada"
        description="No tienes una sucursal activa asignada. Contacta a tu administrador."
        tone="warning"
      />
    );
  }

  return <OperationalDayPanel branchId={branchId} />;
}
