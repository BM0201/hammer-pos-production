"use client";

import { TimberCalculator } from "@/components/timber/timber-calculator";
import { TimberTrips } from "@/components/timber/timber-trips";
import { Settings2, Package, Truck, Calculator, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function TimberPage() {
  return (
    <section className="space-y-8">
      {/* ── Header ── */}
      <div>
        <div className="mb-1 flex items-center gap-3">
          <div
            className="h-8 w-1 rounded-full"
            style={{
              background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))",
            }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">
              Módulo de Madera
            </h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              Flujo principal: cubicación, precios y control de viajes.
            </p>
          </div>
        </div>
      </div>

      {/* ── Calculadora de Madera ── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="hm-section-icon hm-section-icon-warehouse">
            <Calculator className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Calculadora de Madera</h2>
            <p className="text-xs text-[var(--color-text-muted)]">Cubicación y precios en tiempo real</p>
          </div>
          <div className="ml-auto">
            <Link href={"/app/master/finance?tab=pricing"}>
              <Button variant="ghost" size="sm" icon={<Settings2 className="h-4 w-4" />}>
                Precios
              </Button>
            </Link>
          </div>
        </div>
        <TimberCalculator showHeader={false} />
      </div>

      {/* ── Viajes de Madera ── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="hm-section-icon hm-section-icon-warehouse">
            <Truck className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Viajes de Madera</h2>
            <p className="text-xs text-[var(--color-text-muted)]">Registro de llegadas, cubicación y control de viajes</p>
          </div>
        </div>
        <TimberTrips showHeader={false} />
      </div>

      {/* ── Catálogo como vista dedicada (sin duplicar home) ── */}
      <Card className="border-[var(--color-border)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="hm-section-icon hm-section-icon-warehouse">
              <Package className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--color-text)]">Catálogo de Productos de Madera</h2>
              <p className="text-xs text-[var(--color-text-muted)]">
                Gestión completa en una vista dedicada para evitar duplicación en la home.
              </p>
            </div>
          </div>
          <Link href="/app/master/timber/catalog">
            <Button variant="secondary" size="sm" icon={<ArrowRight className="h-4 w-4" />}>
              Abrir catálogo
            </Button>
          </Link>
        </div>
      </Card>
    </section>
  );
}
