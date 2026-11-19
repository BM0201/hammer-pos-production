"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TimberCalculator } from "@/components/timber/timber-calculator";
import { TimberWorkspace } from "@/components/timber/timber-workspace";
import { TimberConfigPanel } from "@/components/timber/timber-config-panel";
import { TimberList } from "@/components/timber/timber-list";
import { Package, Truck, Calculator, Settings2 } from "lucide-react";

const TABS = [["viajes", "Viajes", Truck], ["catalogo", "Catálogo", Package], ["calculadora", "Calculadora", Calculator], ["config", "Configuración", Settings2]] as const;
type Tab = (typeof TABS)[number][0];

function TimberPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: Tab = TABS.some(([key]) => key === requested) ? (requested as Tab) : "viajes";

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-8 w-1 rounded-full" style={{ background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))" }} />
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Madera</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Del viaje de compra al inventario de cada sucursal.</p>
        </div>
      </div>

      <div role="tablist" className="flex items-center gap-1 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-1">
        {TABS.map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => router.push(key === "viajes" ? "?" : `?tab=${key}`)}
            className={`flex min-h-11 flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold transition-colors sm:flex-1 ${tab === key ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}
          >
            <Icon className="hidden h-4 w-4 sm:block" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {tab === "viajes" && <TimberWorkspace />}
      {tab === "catalogo" && <TimberList />}
      {tab === "calculadora" && <TimberCalculator showHeader={false} />}
      {tab === "config" && <TimberConfigPanel />}
    </section>
  );
}

export default function TimberPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-sm text-[var(--color-text-muted)]">Cargando…</p>}>
      <TimberPageContent />
    </Suspense>
  );
}
