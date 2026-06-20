"use client";

import { ReportsHub } from "@/components/reports/reports-hub";
import { PageHeader } from "@/components/ui/page-header";

export default function MasterReportsPage() {
  return (
    <div className="space-y-0">
      <PageHeader
        title="Reportes & KPIs"
        description="Generación, vista previa y exportación de reportes operativos. Datos en tiempo real por sucursal."
        breadcrumbs={[{ label: "Master", href: "/app/master" }, { label: "Reportes & KPIs" }]}
      />
      <ReportsHub masterMode />
    </div>
  );
}
