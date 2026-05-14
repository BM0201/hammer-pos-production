"use client";

import { ReportsHub } from "@/components/reports/reports-hub";

export default function BranchReportsPage() {
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
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Reportes</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Generación y exportación de reportes operativos</p>
          </div>
        </div>
      </div>
      <ReportsHub />
    </section>
  );
}
