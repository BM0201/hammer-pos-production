"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { Shuffle, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import type { Branch, Transfer } from "@/components/catalog-inventory/catalog-inventory-admin";

/**
 * Fase 5 (prompt-flujo-velocidad.md): extraído de catalog-inventory-admin.tsx
 * (era la pestaña "transfers") para poder cargarlo con next/dynamic — solo
 * se monta cuando el usuario abre esa pestaña. Mismo comportamiento.
 *
 * TRANSFERS PANEL — redirect shortcut to dedicated page
 * The full transfer management lives at /app/master/replenishment (tab Traslados)
 */
export function TransfersPanel({ branches }: { branches: Branch[] }) {
  const [summary, setSummary] = useState<{ total: number; draft: number; transit: number } | null>(null);

  useEffect(() => {
    apiFetch("/api/master/transfers").then(async (res) => {
      if (!res.ok) return;
      const raw = await res.json();
      const list = (unwrapApiData(raw) as Transfer[]) ?? [];
      setSummary({
        total: list.length,
        draft: list.filter((t) => t.status === "DRAFT" || t.status === "APPROVED").length,
        transit: list.filter((t) => t.status === "IN_TRANSIT" || t.status === "PARTIALLY_RECEIVED").length,
      });
    }).catch(() => { /* non-critical */ });
  }, []);

  return (
    <Card noPadding>
      <div className="hm-card-header-blue">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Shuffle className="h-4 w-4" /> Envíos entre sucursales</h2>
      </div>
      <div className="p-6 space-y-4">
        {summary && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-center">
              <p className="text-2xl font-bold text-[var(--color-text)]">{summary.total}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Total envíos</p>
            </div>
            <div className="rounded-xl border border-[var(--color-warning-200)] bg-[color-mix(in_srgb,var(--color-warning-50)_40%,white)] p-3 text-center">
              <p className="text-2xl font-bold text-[var(--color-warning-700)]">{summary.draft}</p>
              <p className="text-xs text-[var(--color-warning-600)] mt-0.5">Pendientes</p>
            </div>
            <div className="rounded-xl border border-[var(--color-info-200)] bg-[color-mix(in_srgb,var(--color-info-50)_40%,white)] p-3 text-center">
              <p className="text-2xl font-bold text-[var(--color-info-700)]">{summary.transit}</p>
              <p className="text-xs text-[var(--color-info-600)] mt-0.5">En tránsito</p>
            </div>
          </div>
        )}
        <div className="rounded-xl border border-[var(--color-master-200)] bg-[var(--color-master-50)] p-4 text-sm text-[var(--color-master-800)]">
          <p className="font-semibold mb-1">Centro de Envíos</p>
          <p className="text-xs leading-relaxed text-[var(--color-master-700)]">
            La gestión completa de envíos entre sucursales — incluyendo sugerencias inteligentes de reabastecimiento, despacho desde la central y seguimiento — se realiza en la sección dedicada.
          </p>
        </div>
        <Link
          href={"/app/master/replenishment" as Route}
          className="flex items-center justify-center gap-2 w-full rounded-xl bg-[var(--color-master-600)] hover:bg-[var(--color-master-700)] px-4 py-3 text-sm font-semibold text-white transition-colors"
        >
          <Shuffle className="h-4 w-4" />
          Ir a Envíos Sucursales
          <ChevronRight className="h-4 w-4" />
        </Link>
        {branches.length > 0 && (
          <p className="text-xs text-center text-[var(--color-text-muted)]">
            {branches.length} sucursal{branches.length !== 1 ? "es" : ""} registrada{branches.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>
    </Card>
  );
}
