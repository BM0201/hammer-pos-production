"use client";

import { AuditLogViewer } from "@/components/audit/audit-log-viewer";

export default function BranchAuditPage() {
  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div
            className="h-8 w-1 rounded-full"
            style={{
              background: "linear-gradient(to bottom, var(--color-branch-admin-400), var(--color-branch-admin-600))",
            }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Bitácora de Sucursal</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Seguimiento operativo para revisión de eventos de tu ámbito autorizado</p>
          </div>
        </div>
      </div>
      <AuditLogViewer branchFixed />
    </section>
  );
}
