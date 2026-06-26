"use client";

import { Suspense } from "react";
import { FinanceAccountingManager } from "@/components/finance/finance-accounting-manager";

export default function MasterFinancePage() {
  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div
            className="h-8 w-1 rounded-full"
            style={{ background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))" }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">
              Finanzas &amp; Contabilidad
            </h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              Gastos operativos, precios, planilla, utilidad y rentabilidad por sucursal.
            </p>
          </div>
        </div>
      </div>

      <Suspense fallback={<div className="p-6 text-sm text-[var(--color-text-muted)]">Cargando finanzas…</div>}>
        <FinanceAccountingManager />
      </Suspense>
    </section>
  );
}
