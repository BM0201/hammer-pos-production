"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { BrainFilters, type BrainFilterState } from "@/components/brain/brain-filters";
import { DecisionCard, type BrainDecision } from "@/components/brain/decision-card";
import { BrainSummary, type BrainKpis } from "@/components/brain/brain-summary";
import type { BrainDecisionAction } from "@/components/brain/decision-action-buttons";

type BranchOption = {
  id: string;
  code: string;
  name: string;
};

type BrainResponse = {
  decisions: BrainDecision[];
  kpis: BrainKpis;
  nextCursor?: string | null;
};

const initialFilters: BrainFilterState = {
  branchId: "",
  category: "",
  severity: "",
  status: "OPEN",
  search: "",
  productId: "",
  targetUserId: "",
  days: "30",
  sort: "priority",
};

export function DecisionCenter() {
  const [filters, setFilters] = useState(initialFilters);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [data, setData] = useState<BrainResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/master/brain/decisions?${query}`);
      const raw = await response.json();
      if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar el Centro de Decisiones.");
      setData(unwrapApiData(raw) as BrainResponse);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error cargando decisiones.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    apiFetch("/api/branches")
      .then((response) => response.json())
      .then((raw) => {
        const list = unwrapApiData(raw);
        setBranches(Array.isArray(list) ? list as BranchOption[] : []);
      })
      .catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function scan(dryRun = false) {
    setBusyAction(dryRun ? "dry-run" : "scan");
    setMessage(null);
    try {
      const response = await apiFetch("/api/master/brain/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: filters.branchId || undefined,
          category: filters.category || undefined,
          days: Number(filters.days || 30),
          dryRun,
        }),
      });
      const raw = await response.json();
      if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo ejecutar el analisis.");
      const result = unwrapApiData(raw) as { created: number; updated: number; reopened: number; expired: number; skipped: number; errors?: unknown[] };
      setMessage(`${dryRun ? "Dry run" : "Analisis"} completado: ${result.created} nuevas, ${result.updated} actualizadas, ${result.reopened} reabiertas, ${result.expired} expiradas, ${result.skipped} omitidas${result.errors?.length ? `, ${result.errors.length} avisos` : ""}.`);
      if (!dryRun) await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error ejecutando analisis.");
    } finally {
      setBusyAction(null);
    }
  }

  async function act(decisionId: string, action: BrainDecisionAction) {
    const note = action === "dismiss" ? window.prompt("Motivo del descarte") ?? undefined : undefined;
    const reviewNote = action === "manual-review" ? window.prompt("Nota para revision manual") ?? undefined : undefined;
    const body = action === "snooze"
      ? { days: 7, note: "Pospuesto desde Centro de Decisiones" }
      : action === "manual-review"
        ? { note: reviewNote }
        : { note };

    setBusyAction(`${decisionId}:${action}`);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/master/brain/decisions/${decisionId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await response.json();
      if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo aplicar la accion.");
      setMessage("Accion aplicada correctamente.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error aplicando accion.");
    } finally {
      setBusyAction(null);
    }
  }

  const kpis = data?.kpis ?? { openCritical: 0, highRisk: 0, estimatedImpact: 0, reorderSuggested: 0, cashRisks: 0, lowMarginPrices: 0, lateDispatches: 0, manualReview: 0 };

  return (
    <main className="space-y-5">
      <header className="hm-page-band flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">H.A.M.M.E.R. Brain</p>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">Centro de Decisiones</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
            Inbox operativo para detectar riesgos, aprobar acciones y dejar trazabilidad antes de tocar inventario, precios, caja o reposicion.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {process.env.NODE_ENV !== "production" ? (
            <button type="button" disabled={Boolean(busyAction)} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-muted)] disabled:text-[var(--color-text-soft)]" onClick={() => scan(true)}>
              {busyAction === "dry-run" ? "Simulando..." : "Dry run"}
            </button>
          ) : null}
          <button type="button" disabled={Boolean(busyAction)} className="rounded-lg bg-[var(--color-info-700)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-info-600)] disabled:bg-[var(--color-surface-alt)] disabled:text-[var(--color-text-soft)]" onClick={() => scan(false)}>
            {busyAction === "scan" ? "Analizando..." : "Escanear ahora"}
          </button>
        </div>
      </header>

      <BrainSummary kpis={kpis} />

      <BrainFilters filters={filters} branches={branches} onChange={setFilters} />

      {message ? <div className="rounded-lg border border-[var(--color-info-200)] bg-[var(--color-info-50)] px-4 py-3 text-sm text-[var(--color-info-800)]">{message}</div> : null}

      <section className="space-y-3">
        {loading ? (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-text-muted)]">Cargando decisiones...</div>
        ) : data?.decisions.length ? (
          data.decisions.map((decision) => (
            <DecisionCard key={decision.id} decision={decision} busy={Boolean(busyAction)} onAction={act} />
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] p-6 text-sm text-[var(--color-text-muted)]">No hay decisiones pendientes con los filtros actuales.</div>
        )}
      </section>
    </main>
  );
}
