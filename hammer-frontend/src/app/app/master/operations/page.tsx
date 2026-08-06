"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, Building2, CheckCircle2, RefreshCw, Wrench,
} from "lucide-react";
import { OperationalDayScanner } from "@/components/operations/operational-day-scanner";
import { OperationalDayChecklist, type ClosePreview } from "@/components/operations/operational-day-checklist";
import { CloseDayDialog } from "@/components/operations/close-day-dialog";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useOperationalPolling } from "@/lib/realtime/use-operational-polling";
import { showToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Día operativo — Master. Reorganizado (2026-07-28) para seguir
 * hammer-dia-operativo-mockup.html: tres accesos por palabra (Operación ·
 * Historial · Ajustes), sin pestañas numeradas. El corazón es una sola lista
 * de acción que une los días pendientes de cierre y los pendientes de
 * aprobación — antes eran dos bandejas flotantes separadas.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

type Branch = { id: string; code: string; name: string };

type BranchLiveStatus = {
  branchId: string;
  branchCode: string;
  branchName: string;
  derivedState:
    | "NOT_OPENED_TODAY" | "OPEN_TODAY" | "CLOSING" | "PENDING_CLOSE"
    | "CLOSED_PENDING_MASTER" | "APPROVED_ARCHIVED" | "CANCELLED" | "STALE_OPEN_DAY";
  totalBlockers: number;
};

type LiveBlockersResponse = { total: number; branches: BranchLiveStatus[] };

type MasterDay = {
  id: string;
  businessDate: string;
  salesTotal: string | number;
  cashDifferenceTotal?: string | number | null;
  closedBy?: { username: string; fullName?: string | null } | null;
  summaryJson?: { paidSalesTotal?: number } | null;
  branch: Branch;
};

type PendingCloseDayRow = {
  id: string; branchId: string; branchCode: string; branchName: string;
  businessDate: string; daysOverdue: number; salesTotal: number; expectedCashTotal: number;
  blockers: { autoClosedPendingReviewCount: number; openOrReconcilingCashSessionsCount: number };
};

type TodayCardData = {
  branchId: string; branchCode: string; branchName: string; dayId: string; openedAt: string;
  paidOrdersTotal: number; expectedCashTotal: number; openCashSessionsCount: number;
};

type ActionRow =
  | { kind: "CLOSE"; id: string; businessDate: string; daysOverdue: number; branchCode: string; branchName: string; expectedCashTotal: number; detail: string }
  | { kind: "APPROVE"; id: string; businessDate: string; daysOverdue: number; branchCode: string; branchName: string; salesTotal: number; cashDifferenceTotal: number; closedByName: string | null };

type DailyReport = {
  orders: Array<{ id: string }>;
  summary?: { salesTotal?: number; expectedCashTotal?: number; cashDifferenceTotal?: number };
  lateActivity?: { count: number };
};

type CashToleranceConfig = { defaultToleranceAmount: number; byBranch: Record<string, number> };

// ── Helpers ────────────────────────────────────────────────────────────────────

const money = (v: number | string | null | undefined) =>
  new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(Number(v ?? 0));

function timeAgo(date: Date | null) {
  if (!date) return "sin actualizar";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.floor(minutes / 60)} h`;
}

const daysOverdueFrom = (businessDate: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(businessDate).getTime()) / 86_400_000));

const dayLabel = (businessDate: string) =>
  new Date(businessDate).toLocaleDateString("es-NI", { timeZone: "UTC", day: "numeric", month: "short" });

const agoLabel = (daysOverdue: number) =>
  daysOverdue === 0 ? "hoy" : daysOverdue === 1 ? "hace 1 día" : `hace ${daysOverdue} días`;

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-[0.9375rem] font-bold text-[var(--color-text)]">{title}</h2>
      <p className="text-xs text-[var(--color-text-muted)]">{subtitle}</p>
    </div>
  );
}

const NAV_ITEMS = [["operacion", "Operación"], ["historial", "Historial"], ["ajustes", "Ajustes"]] as const;
type TabKey = (typeof NAV_ITEMS)[number][0];

// ── Main page ──────────────────────────────────────────────────────────────────

export default function MasterOperationsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("operacion");
  const [branches, setBranches] = useState<Branch[]>([]);

  // Estado en vivo + Hoy
  const [liveData, setLiveData] = useState<LiveBlockersResponse | null>(null);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<Date | null>(null);
  const [todayCards, setTodayCards] = useState<TodayCardData[]>([]);
  const [showLifecycleInfo, setShowLifecycleInfo] = useState(false);

  // Pendientes de cierre + pendientes de aprobación (fusionados en una sola lista)
  const [pendingCloseRows, setPendingCloseRows] = useState<PendingCloseDayRow[]>([]);
  const [pendingApprovalDays, setPendingApprovalDays] = useState<MasterDay[]>([]);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [reopenTarget, setReopenTarget] = useState<{ dayId: string; branchCode: string } | null>(null);
  const [reopenNote, setReopenNote] = useState("");

  // Conciliación de cierre — compartida entre "Conciliar y cerrar" y "Cerrar día" (Hoy)
  const [reconcileDayId, setReconcileDayId] = useState<string | null>(null);
  const [reconcilePreview, setReconcilePreview] = useState<ClosePreview | null>(null);

  // Historial
  const today = new Date().toISOString().split("T")[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(sevenDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [historyBranch, setHistoryBranch] = useState("");
  const [historyDays, setHistoryDays] = useState<MasterDay[]>([]);
  const [historyRefreshing, setHistoryRefreshing] = useState(false);
  const [selectedHistoryDayId, setSelectedHistoryDayId] = useState<string | null>(null);
  const [historyReport, setHistoryReport] = useState<DailyReport | null>(null);
  const [historyReportLoading, setHistoryReportLoading] = useState(false);

  // Ajustes — tolerancia de caja + herramientas de fuerza
  const [tolerance, setTolerance] = useState<CashToleranceConfig | null>(null);
  const [toleranceSaving, setToleranceSaving] = useState(false);
  const [forceOpen, setForceOpen] = useState(false);
  const [forceBranchId, setForceBranchId] = useState("");

  // ── Load branches once ──
  useEffect(() => {
    apiFetch("/api/branches")
      .then((r) => r.json())
      .then((raw) => setBranches(unwrapApiData(raw) as Branch[]))
      .catch(() => showToast("error", "No se pudieron cargar sucursales."));
  }, []);

  // ── Load "Hoy" cards (uno por sucursal abierta hoy) ──
  const loadTodayCards = useCallback(async (openBranches: BranchLiveStatus[]) => {
    const results = await Promise.all(openBranches.map(async (b): Promise<TodayCardData | null> => {
      try {
        const resp = await apiFetch(`/api/branch/operations/current?branchId=${b.branchId}`);
        const raw = await resp.json();
        if (!resp.ok) return null;
        const { day } = unwrapApiData(raw) as {
          day: { id: string; openedAt: string; paidOrdersTotal: string | number; expectedCashTotal?: string | number | null; openCashSessionsCount: number } | null;
        };
        if (!day) return null;
        return {
          branchId: b.branchId, branchCode: b.branchCode, branchName: b.branchName, dayId: day.id, openedAt: day.openedAt,
          paidOrdersTotal: Number(day.paidOrdersTotal ?? 0), expectedCashTotal: Number(day.expectedCashTotal ?? 0),
          openCashSessionsCount: day.openCashSessionsCount ?? 0,
        };
      } catch { return null; }
    }));
    setTodayCards(results.filter((r): r is TodayCardData => r !== null));
  }, []);

  // ── Load live blockers ──
  const loadLive = useCallback(async () => {
    try {
      const resp = await apiFetch("/api/master/operations/live-blockers");
      const raw = await resp.json();
      if (resp.ok) {
        const data = unwrapApiData(raw) as LiveBlockersResponse;
        setLiveData(data);
        setLiveUpdatedAt(new Date());
        void loadTodayCards(data.branches.filter((b) => b.derivedState === "OPEN_TODAY"));
      }
    } catch { /* silent refresh */ }
  }, [loadTodayCards]);

  useOperationalPolling({ task: loadLive, intervalMs: 30_000, deps: [loadLive] });

  // ── Load pendientes de cierre / aprobación ──
  const loadPendingClose = useCallback(async () => {
    try {
      const resp = await apiFetch("/api/master/operations/pending-close");
      const raw = await resp.json();
      if (resp.ok) setPendingCloseRows(unwrapApiData(raw) as PendingCloseDayRow[]);
    } catch { /* silent refresh */ }
  }, []);
  useOperationalPolling({ task: loadPendingClose, intervalMs: 30_000, deps: [loadPendingClose] });

  const loadPendingApproval = useCallback(async () => {
    try {
      const resp = await apiFetch("/api/master/operations?reviewState=pending");
      const raw = await resp.json();
      if (resp.ok) setPendingApprovalDays(unwrapApiData(raw) as MasterDay[]);
    } catch { /* silent refresh */ }
  }, []);
  useOperationalPolling({ task: loadPendingApproval, intervalMs: 30_000, deps: [loadPendingApproval] });

  // ── Load historial (días aprobados) ──
  const loadHistory = useCallback(async () => {
    setHistoryRefreshing(true);
    try {
      const params = new URLSearchParams({ reviewState: "approved" });
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (historyBranch) params.set("branchId", historyBranch);
      const resp = await apiFetch(`/api/master/operations?${params.toString()}`);
      const raw = await resp.json();
      if (resp.ok) setHistoryDays(unwrapApiData(raw) as MasterDay[]);
      else showToast("error", raw?.error?.message ?? "Error cargando historial.");
    } finally {
      setHistoryRefreshing(false);
    }
  }, [dateFrom, dateTo, historyBranch]);

  useEffect(() => { if (activeTab === "historial") void loadHistory(); }, [activeTab, loadHistory]);

  const selectHistoryDay = useCallback(async (id: string) => {
    setSelectedHistoryDayId(id);
    setHistoryReport(null);
    setHistoryReportLoading(true);
    try {
      const resp = await apiFetch(`/api/branch/operations/${id}/daily-report`);
      const raw = await resp.json();
      if (resp.ok) setHistoryReport(unwrapApiData(raw) as DailyReport);
      else showToast("error", raw?.error?.message ?? "No se pudo cargar el reporte.");
    } catch {
      showToast("error", "Error de red al cargar el reporte.");
    } finally {
      setHistoryReportLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "historial" || historyDays.length === 0) return;
    if (!historyDays.some((d) => d.id === selectedHistoryDayId)) void selectHistoryDay(historyDays[0].id);
  }, [activeTab, historyDays, selectedHistoryDayId, selectHistoryDay]);

  // ── Ajustes: tolerancia de caja ──
  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/master/operations/cash-tolerance-config")
      .then((r) => r.json())
      .then((raw) => { if (!cancelled) setTolerance(unwrapApiData(raw) as CashToleranceConfig); })
      .catch(() => showToast("error", "No se pudo cargar la tolerancia de caja."));
    return () => { cancelled = true; };
  }, []);

  async function saveTolerance() {
    if (!tolerance) return;
    setToleranceSaving(true);
    try {
      const resp = await apiFetch("/api/master/operations/cash-tolerance-config", { method: "PUT", body: JSON.stringify(tolerance) });
      const raw = await resp.json();
      if (!resp.ok) { showToast("error", raw?.error?.message ?? "No se pudo guardar."); return; }
      setTolerance(unwrapApiData(raw) as CashToleranceConfig);
      showToast("success", "Tolerancia de caja guardada.");
    } catch {
      showToast("error", "Error de red al guardar.");
    } finally {
      setToleranceSaving(false);
    }
  }

  // ── Acciones: aprobar / reabrir ──
  async function approveDay(dayId: string, branchCode: string) {
    setApprovingId(dayId);
    try {
      const resp = await apiFetch(`/api/master/operations/${dayId}/approve`, { method: "POST" });
      const raw = await resp.json();
      if (resp.status === 409) {
        const blockerList = (raw?.data ?? []) as Array<{ label: string; count: number }>;
        const detail = blockerList.map((b) => `${b.label} (${b.count})`).join(" · ");
        showToast("warning", `${branchCode}: No se puede aprobar — ${detail || (raw?.error?.message ?? "hay bloqueantes.")}`);
        return;
      }
      if (!resp.ok) { showToast("error", `${branchCode}: ${raw?.error?.message ?? "No se pudo aprobar."}`); return; }
      showToast("success", `Día de ${branchCode} aprobado.`);
      await Promise.all([loadPendingApproval(), loadLive()]);
    } catch { showToast("error", "Error de red al aprobar."); }
    finally { setApprovingId(null); }
  }

  async function confirmReopenDay() {
    if (!reopenTarget) return;
    if (!reopenNote.trim()) { showToast("warning", "La nota es requerida."); return; }
    setReopeningId(reopenTarget.dayId);
    try {
      const resp = await apiFetch(`/api/master/operations/${reopenTarget.dayId}/reopen`, {
        method: "POST", body: JSON.stringify({ note: reopenNote.trim() }),
      });
      const raw = await resp.json();
      if (!resp.ok) { showToast("error", `${reopenTarget.branchCode}: ${raw?.error?.message ?? "No se pudo reabrir."}`); return; }
      showToast("success", `Día de ${reopenTarget.branchCode} reabierto.`);
      setReopenTarget(null);
      await Promise.all([loadPendingApproval(), loadHistory(), loadLive()]);
    } catch { showToast("error", "Error de red al reabrir."); }
    finally { setReopeningId(null); }
  }

  // ── Conciliación de cierre (pendientes de cierre + "Cerrar día" de Hoy) ──
  function openReconcile(dayId: string) {
    setReconcileDayId(dayId);
    setReconcilePreview(null);
  }

  async function previewReconcile() {
    if (!reconcileDayId) return;
    try {
      const resp = await apiFetch(`/api/branch/operations/${reconcileDayId}/close-preview`, { method: "POST" });
      const raw = await resp.json();
      if (!resp.ok) { showToast("error", raw?.error?.message ?? "No se pudo previsualizar el cierre."); return; }
      setReconcilePreview(unwrapApiData(raw) as ClosePreview);
    } catch { showToast("error", "Error de red al previsualizar."); }
  }

  async function closeReconcile(note: string, forceClose: boolean) {
    if (!reconcileDayId) return;
    try {
      const resp = await apiFetch(`/api/branch/operations/${reconcileDayId}/close`, {
        method: "POST", body: JSON.stringify({ note, forceClose }),
      });
      const raw = await resp.json();
      if (!resp.ok) { showToast("error", raw?.error?.message ?? "No se pudo cerrar el día."); return; }
      showToast("success", "Día cerrado — enviado a revisión MASTER.");
      setReconcileDayId(null);
      setReconcilePreview(null);
      await Promise.all([loadLive(), loadPendingClose(), loadPendingApproval()]);
    } catch { showToast("error", "Error de red al cerrar."); }
  }

  // ── Lista de acción unificada ──
  const actionRows: ActionRow[] = useMemo(() => {
    const closeRows: ActionRow[] = pendingCloseRows.map((r) => ({
      kind: "CLOSE", id: r.id, businessDate: r.businessDate, daysOverdue: r.daysOverdue,
      branchCode: r.branchCode, branchName: r.branchName, expectedCashTotal: r.expectedCashTotal,
      detail: r.blockers.openOrReconcilingCashSessionsCount > 0
        ? `${r.blockers.openOrReconcilingCashSessionsCount} caja(s) abierta(s)`
        : r.blockers.autoClosedPendingReviewCount > 0
          ? `${r.blockers.autoClosedPendingReviewCount} caja(s) sin revisar`
          : "Solo falta firmar",
    }));
    const approveRows: ActionRow[] = pendingApprovalDays.map((d) => ({
      kind: "APPROVE", id: d.id, businessDate: d.businessDate, daysOverdue: daysOverdueFrom(d.businessDate),
      branchCode: d.branch.code, branchName: d.branch.name,
      salesTotal: Number(d.summaryJson?.paidSalesTotal ?? d.salesTotal),
      cashDifferenceTotal: Number(d.cashDifferenceTotal ?? 0),
      closedByName: d.closedBy?.fullName ?? d.closedBy?.username ?? null,
    }));
    return [...closeRows, ...approveRows].sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [pendingCloseRows, pendingApprovalDays]);

  const reconcileLabel = useMemo(() => {
    if (!reconcileDayId) return null;
    const fromAction = actionRows.find((r) => r.id === reconcileDayId);
    if (fromAction) return `${fromAction.branchCode} — ${dayLabel(fromAction.businessDate)}`;
    const fromToday = todayCards.find((t) => t.dayId === reconcileDayId);
    return fromToday ? `${fromToday.branchCode} — hoy` : null;
  }, [reconcileDayId, actionRows, todayCards]);

  const selectedHistoryDay = historyDays.find((d) => d.id === selectedHistoryDayId) ?? null;
  const forceBranch = branches.find((b) => b.id === forceBranchId) ?? null;
  const openTodayCount = liveData?.branches.filter((b) => b.derivedState === "OPEN_TODAY").length ?? 0;
  const totalBlockers = liveData?.total ?? 0;

  // ── Render ──
  return (
    <div className="space-y-5">
      <PageHeader
        title="Día operativo"
        description="Control en tiempo real: qué requiere tu acción hoy, historial firmado y ajustes."
      />

      {reopenTarget && (
        <Card className="border-[var(--color-warning-200)] p-4">
          <p className="text-sm font-bold text-[var(--color-text)]">Reabrir día de {reopenTarget.branchCode}</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">Escribe una nota de justificación (requerida).</p>
          <textarea
            autoFocus rows={2} value={reopenNote} onChange={(e) => setReopenNote(e.target.value)}
            placeholder="Motivo de la reapertura…" className="hm-input mt-2 w-full text-sm"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setReopenTarget(null)}>Cancelar</Button>
            <Button variant="primary" size="sm" loading={reopeningId === reopenTarget.dayId} onClick={confirmReopenDay}>
              Confirmar reapertura
            </Button>
          </div>
        </Card>
      )}

      <nav role="tablist" className="flex items-center gap-0.5 border-b border-[var(--color-border)] pb-3">
        {NAV_ITEMS.map(([key, label]) => (
          <button
            key={key} type="button" role="tab" aria-selected={activeTab === key} onClick={() => setActiveTab(key)}
            className="rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors"
            style={activeTab === key
              ? { color: "var(--color-text)", background: "var(--color-surface)", boxShadow: "var(--shadow-card)" }
              : { color: "var(--color-text-soft)" }}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* ═══ OPERACIÓN ═══════════════════════════════════════════════════════ */}
      {activeTab === "operacion" && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-baseline gap-5 border-b border-[var(--color-border)] pb-4 text-sm text-[var(--color-text-secondary)]">
            <span className="flex items-baseline gap-1.5"><b className="hm-num text-lg font-bold text-[var(--color-text)]">{openTodayCount}</b> sucursales abiertas</span>
            <span className="flex items-baseline gap-1.5"><b className={`hm-num text-lg font-bold ${totalBlockers > 0 ? "text-[var(--color-danger-700)]" : "text-[var(--color-text)]"}`}>{totalBlockers}</b> bloqueos</span>
            <span className="flex items-baseline gap-1.5"><b className={`hm-num text-lg font-bold ${actionRows.length > 0 ? "text-[var(--color-warning-700)]" : "text-[var(--color-text)]"}`}>{actionRows.length}</b> esperan tu acción</span>
            <button type="button" onClick={() => setShowLifecycleInfo((v) => !v)} className="text-xs font-semibold text-[var(--color-master-600)] hover:underline">
              ¿Cómo funciona?
            </button>
            <button
              type="button"
              onClick={() => { void loadLive(); void loadPendingClose(); void loadPendingApproval(); }}
              className="ml-auto flex items-center gap-1.5 text-xs text-[var(--color-text-soft)] hover:text-[var(--color-text)]"
            >
              <RefreshCw style={{ width: "0.75rem", height: "0.75rem" }} />
              {timeAgo(liveUpdatedAt)}
            </button>
          </div>

          {showLifecycleInfo && (
            <Card className="space-y-2 p-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              <p>
                Un día que no cierra en su fecha <b className="text-[var(--color-text)]">nunca bloquea hoy ni se pierde</b> — pasa a{" "}
                <Badge variant="warning">Pendiente de cierre</Badge> y espera en la lista de acción hasta que el Master lo concilie con calma.
              </p>
              <p>Sus cajas huérfanas pasan a revisión; nada se force-cierra en silencio.</p>
            </Card>
          )}

          <div className="space-y-3">
            <SectionHeading title="Requiere tu acción" subtitle="Ordenado por urgencia. Un día que no cerró en su fecha nunca bloquea hoy — espera aquí." />
            {actionRows.length === 0 ? (
              <Card className="border-dashed p-8 text-center">
                <CheckCircle2 className="mx-auto mb-2 text-[var(--color-success-600)]" style={{ width: "1.5rem", height: "1.5rem" }} />
                <p className="text-sm text-[var(--color-text-muted)]">Sin días esperando acción.</p>
              </Card>
            ) : (
              <div className="stagger-children space-y-2">
                {actionRows.map((row) => (
                  <ActionListRow
                    key={`${row.kind}-${row.id}`} row={row} approvingId={approvingId} reopeningId={reopeningId}
                    onReconcile={openReconcile} onApprove={approveDay}
                    onReopen={(dayId, branchCode) => { setReopenTarget({ dayId, branchCode }); setReopenNote(""); }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <SectionHeading title="Hoy" subtitle="Días abiertos · ventana 06:00 – 06:00" />
            {todayCards.length === 0 ? (
              <Card className="border-dashed p-6 text-center text-sm text-[var(--color-text-muted)]">Sin sucursales abiertas hoy.</Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {todayCards.map((data) => <TodayCard key={data.branchId} data={data} onCloseDay={openReconcile} />)}
              </div>
            )}
          </div>

          {reconcileDayId && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[var(--color-text)]">Conciliar y cerrar{reconcileLabel ? ` — ${reconcileLabel}` : ""}</h2>
                <Button variant="ghost" size="sm" onClick={() => { setReconcileDayId(null); setReconcilePreview(null); }}>Cancelar</Button>
              </div>
              <OperationalDayChecklist preview={reconcilePreview} onPreview={previewReconcile} />
              <CloseDayDialog preview={reconcilePreview} isMaster onPreview={previewReconcile} onCloseDay={closeReconcile} />
            </div>
          )}
        </div>
      )}

      {/* ═══ HISTORIAL ═══════════════════════════════════════════════════════ */}
      {activeTab === "historial" && (
        <div className="space-y-3">
          <SectionHeading title="Historial" subtitle="Días aprobados. Cada uno abre su reporte — el snapshot inmutable con que se firmó." />

          <section className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="space-y-3">
              <Card className="space-y-2 p-3">
                <label className="grid gap-1 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Desde</span>
                  <input type="date" className="hm-input text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Hasta</span>
                  <input type="date" className="hm-input text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Sucursal</span>
                  <select className="hm-input text-sm" value={historyBranch} onChange={(e) => setHistoryBranch(e.target.value)}>
                    <option value="">Todas</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                  </select>
                </label>
                <Button variant="secondary" size="sm" loading={historyRefreshing} onClick={loadHistory} icon={<RefreshCw className="h-3.5 w-3.5" />}>
                  Buscar
                </Button>
              </Card>

              <div className="flex flex-col gap-1">
                {historyDays.map((d) => (
                  <button
                    key={d.id} type="button" onClick={() => selectHistoryDay(d.id)} className="rounded-lg px-3 py-2.5 text-left text-sm"
                    style={selectedHistoryDayId === d.id
                      ? { background: "var(--color-surface)", border: "1px solid var(--color-border)", boxShadow: "var(--shadow-card)" }
                      : { border: "1px solid transparent" }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--color-text)]">{dayLabel(d.businessDate)} · {d.branch.code}</span>
                      <span className="hm-num text-xs text-[var(--color-text-muted)]">{money(d.summaryJson?.paidSalesTotal ?? d.salesTotal)}</span>
                    </div>
                  </button>
                ))}
                {historyDays.length === 0 && (
                  <p className="px-3 py-8 text-center text-sm text-[var(--color-text-muted)]">Sin días aprobados en este rango.</p>
                )}
              </div>
            </div>

            <div>
              {historyReportLoading ? (
                <p className="p-8 text-center text-sm text-[var(--color-text-muted)]">Cargando reporte…</p>
              ) : historyReport && selectedHistoryDay ? (
                <Card className="space-y-4 p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <p className="text-[0.9375rem] font-bold text-[var(--color-text)]">
                        {dayLabel(selectedHistoryDay.businessDate)} · {selectedHistoryDay.branch.code} {selectedHistoryDay.branch.name}
                      </p>
                      <p className="text-xs text-[var(--color-text-soft)]">
                        {selectedHistoryDay.closedBy ? `Cerrado por ${selectedHistoryDay.closedBy.fullName ?? selectedHistoryDay.closedBy.username}` : "Cerrado"}
                      </p>
                    </div>
                    <span className="ml-auto hm-chip hm-chip-info text-xs">📸 snapshot</span>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-[var(--color-text-muted)]">Ventas pagadas</p>
                      <p className="hm-num text-lg font-bold text-[var(--color-text)]">{money(historyReport.summary?.salesTotal)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--color-text-muted)]">Efectivo esperado</p>
                      <p className="hm-num text-lg font-bold text-[var(--color-text)]">{money(historyReport.summary?.expectedCashTotal)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--color-text-muted)]">Diferencia de caja</p>
                      <p className="hm-num text-lg font-bold" style={{ color: Number(historyReport.summary?.cashDifferenceTotal ?? 0) !== 0 ? "var(--color-warning-700)" : "var(--color-success-700)" }}>
                        {money(historyReport.summary?.cashDifferenceTotal)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--color-text-muted)]">Órdenes pagadas</p>
                      <p className="hm-num text-lg font-bold text-[var(--color-text)]">{historyReport.orders.length}</p>
                    </div>
                  </div>

                  {(historyReport.lateActivity?.count ?? 0) > 0 && (
                    <div className="hm-alert hm-alert-warning">
                      <AlertTriangle style={{ width: "0.875rem", height: "0.875rem" }} />
                      <div>{historyReport.lateActivity!.count} venta(s) offline sincronizó después del cierre — se muestra aparte, no altera el número firmado.</div>
                    </div>
                  )}
                </Card>
              ) : (
                <EmptyState title="Selecciona un día" description="Elige un día aprobado de la lista para ver su reporte firmado." tone="info" />
              )}
            </div>
          </section>
        </div>
      )}

      {/* ═══ AJUSTES ═════════════════════════════════════════════════════════ */}
      {activeTab === "ajustes" && (
        <div className="space-y-3">
          <SectionHeading title="Ajustes" subtitle="Tolerancia de caja, política de cierre y herramientas de mantenimiento." />

          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="space-y-3 p-4">
              <div className="hm-section-rule">Tolerancia de diferencia de caja</div>
              {!tolerance ? (
                <p className="text-sm text-[var(--color-text-muted)]">Cargando…</p>
              ) : (
                <>
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium text-[var(--color-text-secondary)]">Default global (C$)</span>
                    <input
                      type="number" min="0" step="0.01" value={tolerance.defaultToleranceAmount}
                      onChange={(e) => setTolerance({ ...tolerance, defaultToleranceAmount: Number(e.target.value) || 0 })}
                      className="hm-input w-40 font-mono"
                    />
                  </label>
                  <div className="grid gap-2">
                    {branches.map((b) => (
                      <div key={b.id} className="grid grid-cols-[1fr_auto] items-center gap-3">
                        <span className="text-sm font-semibold text-[var(--color-text)]">{b.code} — {b.name}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-[var(--color-text-soft)]">C$</span>
                          <input
                            type="number" min="0" step="0.01" value={tolerance.byBranch[b.id] ?? tolerance.defaultToleranceAmount}
                            onChange={(e) => setTolerance({ ...tolerance, byBranch: { ...tolerance.byBranch, [b.id]: Number(e.target.value) || 0 } })}
                            className="hm-input w-28 font-mono"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="hm-alert hm-alert-info">Dentro de la tolerancia → advertencia (no bloquea). Fuera → exige revisión/justificación.</div>
                  <div className="flex justify-end">
                    <Button size="sm" onClick={saveTolerance} loading={toleranceSaving}>Guardar tolerancia</Button>
                  </div>
                </>
              )}
            </Card>

            <div className="space-y-3">
              <Card className="space-y-2 border-[var(--color-warning-200)] p-4">
                <div className="hm-section-rule">Días que no cierran en su fecha</div>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  <b>Pendiente, nunca bloquea</b> <Badge variant="warning">recomendado, siempre activo</Badge> — el día viejo pasa a la lista de acción; hoy abre normal; el Master lo cierra cuando puede.
                </p>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  El toggle <b>&quot;Cierre automático del día&quot;</b> en{" "}
                  <Link href="/app/master/settings/operational-automation" className="font-semibold text-[var(--color-master-600)] hover:underline">Automatización Operativa</Link>{" "}
                  sigue disponible como alternativa opcional — pero nunca reemplaza la regla de fondo.
                </p>
                <div className="hm-alert hm-alert-warning">Nunca se force-cierra un día viejo con cajas abiertas en silencio: eso perdería el conteo físico.</div>
              </Card>

              <Card className="space-y-2 p-4">
                <div className="hm-section-rule">Herramientas de fuerza</div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">Escáner de días atascados y cierre forzado. Uso excepcional, auditado.</p>
                  <Button variant="secondary" size="sm" onClick={() => setForceOpen((v) => !v)} icon={<Wrench className="h-3.5 w-3.5" />}>
                    {forceOpen ? "Cerrar" : "Abrir"}
                  </Button>
                </div>
                {forceOpen && (
                  <div className="space-y-2 pt-2">
                    <label className="grid gap-1 text-xs">
                      <span className="flex items-center gap-1 font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                        <Building2 style={{ width: "0.75rem", height: "0.75rem" }} /> Sucursal a escanear
                      </span>
                      <select className="hm-input text-sm" value={forceBranchId} onChange={(e) => setForceBranchId(e.target.value)}>
                        <option value="">Selecciona una sucursal…</option>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                      </select>
                    </label>
                    {forceBranchId && forceBranch && (
                      <OperationalDayScanner
                        key={forceBranchId} branchId={forceBranchId} branchCode={forceBranch.code}
                        onResolved={async () => { await Promise.all([loadLive(), loadPendingClose()]); }}
                      />
                    )}
                  </div>
                )}
              </Card>

              <Card className="space-y-1.5 p-4">
                <div className="hm-section-rule">Integridad</div>
                <div className="flex justify-between text-sm"><span className="text-[var(--color-text-muted)]">Aritmética de dinero</span><b>Decimal exacto</b></div>
                <div className="flex justify-between text-sm"><span className="text-[var(--color-text-muted)]">Reporte de día cerrado</span><b>Snapshot inmutable</b></div>
                <div className="flex justify-between text-sm"><span className="text-[var(--color-text-muted)]">Actividad tardía</span><b>Se muestra aparte</b></div>
                <div className="flex justify-between text-sm"><span className="text-[var(--color-text-muted)]">Día sin cerrar</span><b>Lista de acción</b></div>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Requiere tu acción — fila ────────────────────────────────────────────────

function ActionListRow({
  row, approvingId, reopeningId, onReconcile, onApprove, onReopen,
}: {
  row: ActionRow; approvingId: string | null; reopeningId: string | null;
  onReconcile: (id: string) => void; onApprove: (id: string, branchCode: string) => void; onReopen: (id: string, branchCode: string) => void;
}) {
  const isClose = row.kind === "CLOSE";
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="min-w-[5rem]">
        <div className="text-sm font-bold capitalize text-[var(--color-text)]">{dayLabel(row.businessDate)}</div>
        <div className="text-xs text-[var(--color-text-soft)]">{agoLabel(row.daysOverdue)}</div>
      </div>

      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: isClose ? "var(--color-warning-700)" : "var(--color-master-700)" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: isClose ? "var(--color-warning-600)" : "var(--color-master-600)" }} />
          {isClose ? "Pendiente de cierre" : "Espera tu aprobación"}
        </span>
        <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
          {row.branchCode} {row.branchName} · {isClose ? row.detail : `diferencia de caja ${money(row.cashDifferenceTotal)} · cerró ${row.closedByName ?? "—"}`}
        </p>
      </div>

      <div className="text-right">
        <div className="hm-num text-sm font-bold text-[var(--color-text)]">{money(isClose ? row.expectedCashTotal : row.salesTotal)}</div>
        <div className="text-[0.625rem] text-[var(--color-text-soft)]">{isClose ? "efectivo esperado" : "ventas del día"}</div>
      </div>

      <div className="flex items-center gap-1.5">
        {isClose ? (
          <Button variant="primary" size="sm" onClick={() => onReconcile(row.id)}>Conciliar y cerrar</Button>
        ) : (
          <>
            <Button variant="primary" size="sm" loading={approvingId === row.id} onClick={() => onApprove(row.id, row.branchCode)}>Aprobar</Button>
            <Button variant="ghost" size="sm" loading={reopeningId === row.id} onClick={() => onReopen(row.id, row.branchCode)} className="text-[var(--color-warning-700)]">
              Reabrir
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Hoy — tarjeta compacta por sucursal abierta ─────────────────────────────

function TodayCard({ data, onCloseDay }: { data: TodayCardData; onCloseDay: (dayId: string) => void }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-[var(--color-text)]">
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--color-success-600)] animate-pulse-soft" />
          {data.branchCode} {data.branchName}
        </div>
        <span className="text-xs text-[var(--color-text-soft)]">desde {new Date(data.openedAt).toLocaleTimeString("es-NI", { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Ventas pagadas</span><b className="hm-num">{money(data.paidOrdersTotal)}</b></div>
        <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Efectivo en caja (esperado)</span><b className="hm-num">{money(data.expectedCashTotal)}</b></div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
        <span className="text-xs text-[var(--color-text-soft)]">{data.openCashSessionsCount} caja{data.openCashSessionsCount !== 1 ? "s" : ""} abierta{data.openCashSessionsCount !== 1 ? "s" : ""}</span>
        <Button variant="secondary" size="sm" onClick={() => onCloseDay(data.dayId)}>Cerrar día</Button>
      </div>
    </Card>
  );
}
