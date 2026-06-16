"use client";

import { ApprovalsQueue } from "@/components/approvals/approvals-queue";

export default function MasterApprovalsPage() {
  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div
            className="h-8 w-1 rounded-full"
            style={{
              background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))",
            }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Aprobaciones Globales</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Centraliza revisión y resolución de solicitudes operativas entre sucursales.</p>
          </div>
        </div>
      </div>
      <ApprovalsQueue />
    </section>
  );
}
