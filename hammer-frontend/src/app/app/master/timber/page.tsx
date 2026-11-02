"use client";

import { useState } from "react";
import { TimberCalculator } from "@/components/timber/timber-calculator";
import { TimberWorkspace, TimberConfigPanel } from "@/components/timber/timber-workspace";
import { TimberList } from "@/components/timber/timber-list";
import { Package, Truck, Calculator, Settings2 } from "lucide-react";

export default function TimberPage() {
  const [tab, setTab] = useState<"viajes" | "catalogo" | "calculadora" | "config">("viajes");

  return (
    <section className="space-y-6">
      <div>
        <div className="mb-1 flex items-center gap-3">
          <div className="h-8 w-1 rounded-full" style={{ background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))" }} />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Módulo de Madera</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Del viaje al costo inyectado en cada medida.</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-1">
        {([["viajes", "Viajes", Truck], ["catalogo", "Catálogo", Package], ["calculadora", "Calculadora", Calculator], ["config", "Configuración", Settings2]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-1 py-2 text-[12.5px] font-semibold sm:px-3 ${tab === key ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm" : "text-[var(--color-text-muted)]"}`}
          >
            <Icon className="hidden h-3.5 w-3.5 sm:block" /> {label}
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
