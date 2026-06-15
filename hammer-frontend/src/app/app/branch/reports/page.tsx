"use client";

import { ReportsHub } from "@/components/reports/reports-hub";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/loading-state";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { useSession } from "@/lib/client/session";

export default function BranchReportsPage() {
  const sessionState = useSession();

  if (sessionState.status === "loading") {
    return <LoadingState message="Cargando..." />;
  }

  const branchId = sessionState.status === "authenticated"
    ? getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId) ?? ""
    : "";

  return (
    <div className="space-y-0">
      <PageHeader
        title="Reportes"
        description="Vista previa y exportación de reportes operativos de tu sucursal."
        breadcrumbs={[{ label: "Sucursal", href: "/app/branch" }, { label: "Reportes" }]}
      />
      <ReportsHub defaultBranchId={branchId} />
    </div>
  );
}
