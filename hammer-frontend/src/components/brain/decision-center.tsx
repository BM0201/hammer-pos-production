"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, RefreshCcw, Search, CircleCheck, CircleAlert, CircleX, HelpCircle } from "lucide-react";
import toast from "react-hot-toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useSubmitting } from "@/lib/client/use-submitting";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import { healthLineStatus, formatTimeAgo, buildInboxUrl, AREA_LABELS, STATUS_TAB_LABELS, type DecisionAction } from "@/lib/brain-ui";
import { DecisionGroupRow, type DecisionGroupData, type InboxItem } from "@/components/brain/decision-group";
import { DecisionDrawer, type DecisionDetail } from "@/components/brain/decision-drawer";
import { DismissReasonModal } from "@/components/brain/dismiss-reason-modal";

/**
 * prompt-brain-centro-decisiones.md Fase 3 — rediseño completo. Reemplaza
 * DecisionCenter viejo (10 pestañas de estado, 12 chips, 11 toggles, 5
 * modos de escaneo, inputs de ID sueltos, códigos crudos). Esta pantalla
 * es la bandeja del dueño: qué necesita atención, dónde, cuánto cuesta y
 * dónde se resuelve — nada más.
 */

type Branch = { id: string; code: string; name: string };
type StatusView = "PENDING" | "SNOOZED" | "RESOLVED" | "DISMISSED";
type AreaKey = keyof typeof AREA_LABELS;

const STATUS_TABS: StatusView[] = ["PENDING", "SNOOZED", "RESOLVED", "DISMISSED"];
const ENDPOINT_BY_ACTION: Partial<Record<DecisionAction, string>> = {
  RESOLVE: "resolve",
  ACKNOWLEDGE: "resolve",
  SNOOZE: "snooze",
  REOPEN: "reopen",
  RUN: "run",
};

type InboxResponse = { groups: DecisionGroupData[]; areas: Array<{ area: AreaKey; count: number; criticalCount: number }> };
type HealthResponse = {
  lastRun: { status: "RUNNING" | "OK" | "PARTIAL" | "FAILED"; finishedAt: string | null; detectors: Array<{ key: string; ok: boolean }> | null } | null;
  isRunning: boolean;
  nextScheduledAt: string;
};
type SummaryResponse = {
  criticalPending: number;
  totalPending: number;
  estimatedImpactPending: number;
  resolvedLast7Days: { user: number; auto: number; execution: number };
  pendingOverSevenDays: number;
};

export function DecisionCenter() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [branchId, setBranchId] = useState(searchParams.get("branchId") ?? "");
  const [branches, setBranches] = useState<Branch[]>([]);
  const statusTab = (STATUS_TABS.includes(searchParams.get("status") as StatusView) ? searchParams.get("status") : "PENDING") as StatusView;
  const area = (searchParams.get("area") as AreaKey) || undefined;
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = useState(q);

  const [loading, setLoading] = useState(true);
  const [inbox, setInbox] = useState<InboxResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [scanning, runScan] = useSubmitting();

  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const [itemsByType, setItemsByType] = useState<Map<string, InboxItem[]>>(new Map());
  const [loadingItemsFor, setLoadingItemsFor] = useState<Set<string>>(new Set());

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerDecision, setDrawerDecision] = useState<DecisionDetail | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [dismissTarget, setDismissTarget] = useState<{ ids: string[]; onDone: () => void } | null>(null);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    apiFetch("/api/branches").then((r) => (r.ok ? r.json() : null)).then((raw) => { if (raw) setBranches(unwrapApiData(raw) as Branch[]); }).catch(() => {});
  }, []);

  function updateUrl(next: { branchId?: string; status?: StatusView; area?: AreaKey | ""; q?: string }) {
    const merged = {
      branchId: next.branchId !== undefined ? next.branchId : branchId,
      status: next.status !== undefined ? next.status : statusTab,
      area: next.area !== undefined ? next.area : (area ?? ""),
      q: next.q !== undefined ? next.q : debouncedQ,
    };
    const url = buildInboxUrl(pathname, merged);
    router.replace(url as Parameters<typeof router.replace>[0], { scroll: false });
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filterParams = new URLSearchParams();
      if (branchId) filterParams.set("branchId", branchId);
      if (area) filterParams.set("area", area);
      if (statusTab !== "PENDING") filterParams.set("status", statusTab);
      if (debouncedQ) filterParams.set("q", debouncedQ);

      const [inboxRes, healthRes, summaryRes] = await Promise.all([
        apiFetch(`/api/master/brain/inbox?${filterParams.toString()}`),
        apiFetch("/api/master/brain/health"),
        apiFetch(`/api/master/brain/summary${branchId ? `?branchId=${branchId}` : ""}`),
      ]);
      const [inboxRaw, healthRaw, summaryRaw] = await Promise.all([inboxRes.json(), healthRes.json(), summaryRes.json()]);
      if (!inboxRes.ok) throw new Error(inboxRaw?.error?.message ?? "No se pudo cargar la bandeja.");
      setInbox(unwrapApiData(inboxRaw) as InboxResponse);
      if (healthRes.ok) setHealth(unwrapApiData(healthRaw) as HealthResponse);
      if (summaryRes.ok) setSummary(unwrapApiData(summaryRaw) as SummaryResponse);
      setItemsByType(new Map());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar la bandeja.");
    } finally {
      setLoading(false);
    }
  }, [branchId, area, statusTab, debouncedQ]);

  useEffect(() => { void load(); }, [load]);

  // Fase 3.4 — colapsados por defecto, salvo los críticos.
  useEffect(() => {
    if (!inbox) return;
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      for (const group of inbox.groups) {
        if (group.severity === "CRITICAL") next.add(group.type);
      }
      return next;
    });
  }, [inbox]);

  async function loadItemsFor(type: string) {
    if (itemsByType.has(type) || loadingItemsFor.has(type)) return;
    setLoadingItemsFor((prev) => new Set(prev).add(type));
    try {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      if (area) params.set("area", area);
      if (statusTab !== "PENDING") params.set("status", statusTab);
      if (debouncedQ) params.set("q", debouncedQ);
      const res = await apiFetch(`/api/master/brain/inbox/${encodeURIComponent(type)}/items?${params.toString()}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudieron cargar las decisiones.");
      const data = unwrapApiData(raw) as { items: InboxItem[] };
      setItemsByType((prev) => new Map(prev).set(type, data.items));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar las decisiones.");
    } finally {
      setLoadingItemsFor((prev) => { const next = new Set(prev); next.delete(type); return next; });
    }
  }

  function toggleGroup(type: string) {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else { next.add(type); void loadItemsFor(type); }
      return next;
    });
    if (!itemsByType.has(type)) void loadItemsFor(type);
  }

  async function openDetail(id: string) {
    setDrawerId(id);
    setDrawerDecision(null);
    try {
      const res = await apiFetch(`/api/master/brain/decisions/${id}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar el detalle.");
      setDrawerDecision(unwrapApiData(raw) as DecisionDetail);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar el detalle.");
      setDrawerId(null);
    }
  }

  async function runAction(id: string, endpoint: string, body: Record<string, unknown>) {
    setActionBusyId(id);
    try {
      const res = await apiFetch(`/api/master/brain/decisions/${id}/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo completar la acción.");
      toast.success("Listo.");
      if (drawerId === id) setDrawerId(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo completar la acción.");
    } finally {
      setActionBusyId(null);
    }
  }

  function handleAction(id: string, action: DecisionAction, extra?: { days?: number }) {
    if (action === "DISMISS") {
      setDismissTarget({ ids: [id], onDone: () => setDismissTarget(null) });
      return;
    }
    if (action === "RUN") {
      if (!window.confirm("¿Ejecutar esta acción? El sistema va a crear o actualizar un registro real.")) return;
      void runAction(id, "run", {});
      return;
    }
    const endpoint = ENDPOINT_BY_ACTION[action];
    if (!endpoint) return;
    void runAction(id, endpoint, action === "SNOOZE" ? { days: extra?.days } : {});
  }

  async function handleBulkAction(ids: string[], action: DecisionAction, extra?: { days?: number }) {
    if (action === "DISMISS") {
      setDismissTarget({
        ids,
        onDone: () => setDismissTarget(null),
      });
      return;
    }
    const bulkAction = action === "RESOLVE" || action === "ACKNOWLEDGE" ? "resolve" : action === "SNOOZE" ? "snooze" : null;
    if (!bulkAction) return;
    try {
      const res = await apiFetch("/api/master/brain/decisions/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action: bulkAction, days: extra?.days }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo completar la acción en lote.");
      const result = unwrapApiData(raw) as { done: number; skipped: number };
      toast.success(`${result.done} actualizada${result.done === 1 ? "" : "s"}${result.skipped > 0 ? ` · ${result.skipped} ya estaban procesadas` : ""}.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo completar la acción en lote.");
    }
  }

  async function confirmDismiss(note: string) {
    if (!dismissTarget) return;
    setDismissing(true);
    try {
      if (dismissTarget.ids.length === 1) {
        await runAction(dismissTarget.ids[0], "dismiss", { note });
      } else {
        const res = await apiFetch("/api/master/brain/decisions/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: dismissTarget.ids, action: "dismiss", note }),
        });
        const raw = await res.json().catch(() => null);
        if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo descartar.");
        await load();
      }
      dismissTarget.onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo descartar.");
    } finally {
      setDismissing(false);
    }
  }

  async function scanNow() {
    await runScan(async () => {
      try {
        const res = await apiFetch("/api/master/brain/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        const raw = await res.json().catch(() => null);
        if (!res.ok) {
          if (raw?.error?.code === "BRAIN_SCAN_RUNNING") { toast("Ya hay un escaneo en curso.", { icon: "⏳" }); return; }
          throw new Error(raw?.error?.message ?? "No se pudo escanear.");
        }
        toast.success("Escaneo completado.");
        await load();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo escanear.");
      }
    });
  }

  const health_ = useMemo(() => {
    if (!health) return null;
    const failedDetector = health.lastRun?.detectors?.find((d) => !d.ok)?.key ?? null;
    return healthLineStatus({
      lastRunFinishedAt: health.lastRun?.finishedAt ? new Date(health.lastRun.finishedAt) : null,
      lastRunStatus: health.lastRun?.status === "RUNNING" ? null : (health.lastRun?.status ?? null),
      failedDetectorKey: failedDetector,
      now: new Date(),
    });
  }, [health]);

  const healthIcon = health_?.level === "ok" ? CircleCheck : health_?.level === "partial" ? CircleAlert : health_?.level === "stale" ? CircleX : HelpCircle;
  const HealthIcon = healthIcon;
  const healthColor = health_?.level === "ok" ? "text-[var(--color-success-600)]" : health_?.level === "partial" ? "text-[var(--color-warning-600)]" : health_?.level === "stale" ? "text-[var(--color-danger-600)]" : "text-[var(--color-text-soft)]";

  return (
    <section className="space-y-5 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text)]">Centro de Decisiones</h1>
          {health_ && (
            <p className={`mt-1 flex items-center gap-1.5 text-xs ${healthColor}`}>
              <HealthIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {health_.message}
              {health?.lastRun?.finishedAt && ` · último escaneo ${formatTimeAgo(new Date(health.lastRun.finishedAt))}`}
            </p>
          )}
        </div>
        <div className="flex items-end gap-2">
          <div className="w-[200px]">
            <label htmlFor="brain-branch" className="mb-1 flex items-center gap-1 text-xs text-[var(--color-text-muted)]"><Building2 className="h-3.5 w-3.5" />Sucursal</label>
            <select id="brain-branch" className="hm-input" value={branchId} onChange={(e) => { setBranchId(e.target.value); updateUrl({ branchId: e.target.value }); }}>
              <option value="">Todas las sucursales</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
            </select>
          </div>
          <Button type="button" variant="primary" onClick={() => void scanNow()} loading={scanning} icon={<RefreshCcw className="h-4 w-4" />}>Escanear ahora</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-[var(--color-text-muted)]">Críticas</p>
          <p className="text-2xl font-semibold text-[var(--color-danger-600)]">{summary?.criticalPending ?? "—"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-[var(--color-text-muted)]">Pendientes</p>
          <p className="text-2xl font-semibold text-[var(--color-text)]">{summary?.totalPending ?? "—"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-[var(--color-text-muted)]">Impacto estimado</p>
          <p className="text-2xl font-semibold text-[var(--color-text)]">{summary ? money(summary.estimatedImpactPending) : "—"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-[var(--color-text-muted)]">Resueltas 7 días</p>
          <p className="text-2xl font-semibold text-[var(--color-text)]">{summary ? summary.resolvedLast7Days.user + summary.resolvedLast7Days.auto + summary.resolvedLast7Days.execution : "—"}</p>
          {summary && <p className="text-xs text-[var(--color-text-muted)]">{summary.resolvedLast7Days.auto + summary.resolvedLast7Days.execution} solas · {summary.resolvedLast7Days.user} por vos</p>}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
        <div className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible">
          <button type="button" onClick={() => updateUrl({ area: "" })} className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm ${!area ? "bg-[var(--color-surface-raised)] font-medium text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}`}>
            Todas las áreas
          </button>
          {(inbox?.areas ?? []).map((a) => (
            <button
              key={a.area}
              type="button"
              onClick={() => updateUrl({ area: a.area })}
              className={`flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${area === a.area ? "bg-[var(--color-surface-raised)] font-medium text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}`}
            >
              <span className="flex items-center gap-1.5">
                {a.criticalCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-danger-500)]" aria-hidden="true" />}
                {AREA_LABELS[a.area] ?? a.area}
              </span>
              <span className="text-xs text-[var(--color-text-soft)]">{a.count}</span>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg bg-[var(--color-surface-raised)] p-1">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => updateUrl({ status: tab })}
                  className={`rounded-md px-3 py-2 text-sm font-medium ${statusTab === tab ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm" : "text-[var(--color-text-muted)]"}`}
                >
                  {STATUS_TAB_LABELS[tab]}
                </button>
              ))}
            </div>
            <div className="relative ml-auto w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-soft)]" aria-hidden="true" />
              <input className="hm-input pl-8" placeholder="Buscar producto, sucursal…" value={q} onChange={(e) => { setQ(e.target.value); updateUrl({ q: e.target.value }); }} />
            </div>
          </div>

          {loading ? (
            <p className="py-12 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Cargando…</p>
          ) : !inbox || inbox.groups.length === 0 ? (
            <Card className="p-10 text-center">
              <CircleCheck className="mx-auto mb-3 h-8 w-8 text-[var(--color-success-500)]" aria-hidden="true" />
              <p className="text-sm font-medium text-[var(--color-text)]">
                {statusTab === "PENDING" ? "Todo en orden." : "No hay nada acá."}
              </p>
              {health?.lastRun?.finishedAt && <p className="mt-1 text-xs text-[var(--color-text-muted)]">Último escaneo {formatTimeAgo(new Date(health.lastRun.finishedAt))}.</p>}
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              {inbox.groups.map((group) => (
                <DecisionGroupRow
                  key={group.type}
                  group={group}
                  expanded={expandedTypes.has(group.type)}
                  onToggleExpand={() => toggleGroup(group.type)}
                  items={itemsByType.get(group.type) ?? null}
                  loadingItems={loadingItemsFor.has(group.type)}
                  allowBulkSelection={statusTab === "PENDING"}
                  onRowAction={handleAction}
                  onBulkAction={(ids, action, extra) => void handleBulkAction(ids, action, extra)}
                  onOpenDetail={openDetail}
                  actionBusyId={actionBusyId}
                />
              ))}
            </Card>
          )}
        </div>
      </div>

      {drawerId && drawerDecision && (
        <DecisionDrawer
          decision={drawerDecision}
          onClose={() => setDrawerId(null)}
          onAction={(action, extra) => handleAction(drawerId, action, extra)}
          busy={actionBusyId === drawerId}
        />
      )}

      {dismissTarget && (
        <DismissReasonModal
          count={dismissTarget.ids.length}
          submitting={dismissing}
          onCancel={() => setDismissTarget(null)}
          onConfirm={(note) => void confirmDismiss(note)}
        />
      )}
    </section>
  );
}
