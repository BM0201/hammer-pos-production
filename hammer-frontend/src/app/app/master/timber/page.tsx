"use client";

import { useState } from "react";
import { TimberCalculator } from "@/components/timber/timber-calculator";
import { TimberWorkspace, TimberConfigPanel } from "@/components/timber/timber-workspace";
import { Package, Truck, Calculator, Settings2, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function TimberPage() {
  const [tab, setTab] = useState<"viajes" | "calculadora" | "config">("viajes");

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
        {([["viajes", "Viajes", Truck], ["calculadora", "Calculadora rápida", Calculator], ["config", "Configuración", Settings2]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold ${tab === key ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm" : "text-[var(--color-text-muted)]"}`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === "viajes" && <TimberWorkspace />}
      {tab === "calculadora" && <TimberCalculator showHeader={false} />}
      {tab === "config" && <TimberConfigPanel />}

      <Card className="border-[var(--color-border)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="hm-section-icon hm-section-icon-warehouse"><Package className="h-4 w-4" /></div>
            <div>
              <h2 className="text-base font-semibold text-[var(--color-text)]">Catálogo de Productos de Madera</h2>
              <p className="text-xs text-[var(--color-text-muted)]">Gestión completa en una vista dedicada para evitar duplicación en la home.</p>
            </div>
          </div>
          <Link href="/app/master/timber/catalog">
            <Button variant="secondary" size="sm" icon={<ArrowRight className="h-4 w-4" />}>Abrir catálogo</Button>
          </Link>
        </div>
      </Card>
    </section>
  );
}
