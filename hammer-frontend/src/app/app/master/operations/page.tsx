"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Building2, CheckCircle2, RefreshCw, Wrench, Clock3,
} from "lucide-react";
import { OperationalDayScanner } from "@/components/operations/operational-day-scanner";
import { OperationalDayChecklist, type DayChecklist } from "@/components/operations/operational-day-checklist";
import { ConfirmDayDialog } from "@/components/operations/confirm-day-dialog";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useOperationalPolling } from "@/lib/realtime/use-operational-polling";
import { showToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Día Operativo 360 — Master. Tres accesos por palabra (Operación · Historial
 * · Ajustes). El día deja de ser una compuerta y pasa a ser una bitácora: la
 * cola de "En espera de tu confirmación" es única (ya no hay dos bandejas
 * separadas de "pendiente de cierre" y "pendiente de aprobación" — en el
 * modelo nuevo son el mismo estado) y nunca es una alarma: un día puede
 * esperar ahí indefinidamente sin que nadie tenga que actuar con urgencia.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

type Branch = { id: string; code: string; name: string };

type DerivedState = "ACTIVE_TODAY" | "AWAITING_REVIEW" | "CONFIRMED" | "NO_ACTIVITY";

type BranchLiveStatus = {
  branchId: string;
  branchCode: string;
  branchName: string;
  derivedState: DerivedState;
  blockers: {
    openCashSessions: number;
    reconcilingCashSessions: number;
    autoClosedPendingReview: number;
    staleActiveOperationalDays: number;
    staleCashSessions: number;
  };
  totalBlockers: number;
};

type LiveBlockersResponse = { total: number; branches: BranchLiveStatus[]; pendingReviewDaysCount: number };

type MasterDay = {
  id: string;
  businessDate: string;
  salesTotal: string | number;
  cashDifferenceTotal?: string | number | null;
  reviewedBy?: { username: string; fullName?: string | null } | null;
  summaryJson?: { paidSalesTotal?: number } | null;
  branch: Branch;
};

type PendingReviewDayRow = {
  id: string; branchId: string; branchCode: string; branchName: string;
  businessDate: string; daysWaiting: number; salesTotal: number; expectedCashTotal: number;
  attention: { autoClosedPendingReviewCount: number; openOrReconcilingCashSessionsCount: number };
};

type TodayCardData = {
  branchId: string; branchCode: string; branchName: string; dayId: string; openedAt: string;
  paidOrdersTotal: number; expectedCashTotal: number; openCashSessionsCount: number;
};

type DailyReport = {
  orders: Array<{ id: string }>;
  summary?: { salesTotal?: number; expectedCashTotal?: number; cashDifferenceTotal?: number };
  lateActivity?: { count: number };
};

type CashToleranceConfig = { defaultToleranceAmount: number; byBranch: Record<string, number> };
type ScheduleReference = {
  timezone: string;
  weekdayOpenTime: string | null; saturdayOpenTime: string | null; sundayOpenTime: string | null;
  weekdayCloseTime: string | null; saturdayCloseTime: string | null; sundayCloseTime: string | null;
};

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

const dayLabel = (businessDate: string) =>
  new Date(businessDate).toLocaleDateString("es-NI", { timeZone: "UTC", day: "numeric", month: "short" });

const waitingLabel = (daysWaiting: number) =>
  daysWaiting <= 0 ? "hoy" : daysWaiting === 1 ? "hace 1 día" : `hace ${daysWaiting} días`;

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

  // Cola única de confirmación pendiente
  const [pendingRows, setPendingRows] = useState<PendingReviewDayRow[]>([]);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [reopenTarget, setReopenTarget] = useState<{ dayId: string; branchCode: string } | null>(null);
  const [reopenNote, setReopenNote] = useState("");

  // Confirmación — compartida entre la cola y "Cerrar jornada" de Hoy
  const [confirmDayId, setConfirmDayId] = useState<string | null>(null);
  const [confirmSummary, setConfirmSummary] = useState<Record<string, unknown> | null>(null);
  const [confirmChecklist, setConfirmChecklist] = useState<DayChecklist | null>(null);

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
  const [revertTarget, setRevertTarget] = useState<{ dayId: string; label: string } | null>(null);
  const [revertNote, setRevertNote] = useState("");
  const [reverting, setReverting] = useState(false);

  // Ajustes — tolerancia de caja + horario de referencia + herramientas de fuerza
  const [tolerance, setTolerance] = useState<CashToleranceConfig | null>(null);
  const [toleranceSaving, setToleranceSaving] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleReference | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [forceOpen, setForceOpen] = useState(false);
  const [forceBranchId, setForceBranchId] = useState("");

  // ── Load branches once ──
  useEffect(() => {
    apiFetch("/api/branches")
      .then((r) => r.json())
      .then((raw) => setBranches(unwrapApiData(raw) as Branch[]))
      .catch(() => showToast("error", "No se pudieron cargar sucursales."));
  }, []);

  // ── Load "Hoy" cards (uno por sucursal activa hoy) ──
  const loadTodayCards = useCallback(async (activeBranches: BranchLiveStatus[]) => {
    const results = await Promise.all(activeBranches.map(async (b): Promise<TodayCardData | null> => {
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
        void loadTodayCards(data.branches.filter((b) => b.derivedState === "ACTIVE_TODAY"));
      }
    } catch { /* silent refresh */ }
  }, [loadTodayCards]);

  useOperationalPolling({ task: loadLive, intervalMs: 30_000, deps: [loadLive] });

  // ── Load cola de confirmación pendiente ──
  const loadPending = useCallback(async () => {
    try {
      const resp = await apiFetch("/api/master/operations/pending-review");
      const raw = await resp.json();
      if (resp.ok) setPendingRows(unwrapApiData(raw) as PendingReviewDayRow[]);
    } catch { /* silent refresh */ }
  }, []);
  useOperationalPolling({ task: loadPending, intervalMs: 30_000, deps: [loadPending] });

  // ── Load historial (días confirmados) ──
  const loadHistory = useCallback(async () => {
    setHistoryRefreshing(true);
    try {
      const params = new URLSearchParams({ reviewStatus: "CONFIRMED" });
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

  async function confirmRevert() {
    if (!revertTarget) return;
    if (!revertNote.trim()) { showToast("warning", "La nota es requerida."); return; }
    setReverting(true);
    try {
      const resp = await apiFetch(`/api/master/operations/${revertTarget.dayId}/revert`, {
        method: "POST", body: JSON.stringify({ note: revertNote.trim() }),
      });
      const raw = await resp.json();
      if (!resp.ok) { showToast("error", raw?.error?.message ?? "No se pudo revertir la confirmación."); return; }
      showToast("success", "Confirmación revertida — el día vuelve a la cola de pendientes.");
      setRevertTarget(null);
      await Promise.all([loadHistory(), loadPending(), loadLive()]);
    } catch { showToast("error", "Error de red al revertir."); }
    finally { setReverting(false); }
  }

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

  // ── Ajustes: horario de referencia (puramente informativo) ──
  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/master/operational-day-auto-config")
      .then((r) => r.json())
      .then((raw) => { if (!cancelled) setSchedule(unwrapApiData(raw) as ScheduleReference); })
      .catch(() => { /* opcional, no crítico */ });
    return () => { cancelled = true; };
  }, []);

  async function saveSchedule() {
    if (!schedule) return;
    setScheduleSaving(true);
    try {
      const resp = await apiFetch("/api/master/operational-day-auto-config", { method: "PUT", body: JSON.stringify(schedule) });
      const raw = await resp.json();
      if (!resp.ok) { showToast("error", raw?.error?.message ?? "No se pudo guardar."); return; }
      setSchedule(unwrapApiData(raw) as ScheduleReference);
      showToast("success", "Horario de referencia guardado.");
    } catch {
      showToast("error", "Error de red al guardar.");
    } finally {
      setScheduleSaving(false);
    }
  }

  // ── Acción: reabrir (solo el día de HOY, AWAITING_REVIEW → ACTIVE) ──
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
      await Promise.all([loadPending(), loadHistory(), loadLive()]);
    } catch { showToast("error", "Error de red al reabrir."); }
    finally { setReopeningId(null); }
  }

  // ── Confirmación (cola de pendientes o "Cerrar jornada" de Hoy) ──
  function openConfirm(dayId: string) {
    setConfirmDayId(dayId);
    setConfirmSummary(null);
    setConfirmChecklist(null);
  }

  async function previewConfirm() {
    if (!confirmDayId) return;
    try {
      const resp = await apiFetch(`/api/branch/operations/${confirmDayId}/close-preview`);
      const raw = await resp.json();
      if (!resp.ok) { showToast("error", raw?.error?.message ?? "No se pudo calcular el checklist."); return; }
      const data = unwrapApiData(raw) as { summary: Record<string, unknown>; checklist: DayChecklist };
      setConfirmSummary(data.summary);
      setConfirmChecklist(data.checklist);
    } catch { showToast("error", "Error de red al calcular el checklist."); }
  }

  async function confirmNow(note: string) {
    if (!confirmDayId) return;
    try {
      const resp = await apiFetch(`/api/master/operations/${confirmDayId}/confirm`, {
        method: "POST", body: JSON.stringify({ note: note || null }),
      });
      const raw = await resp.json();
      if (!resp.ok) { showToast("error", raw?.error?.message ?? "No se pudo confirmar el día."); return; }
      showToast("success", "Día confirmado.");
      setConfirmDayId(null);
      setConfirmSummary(null);
      setConfirmChecklist(null);
      await Promise.all([loadLive(), loadPending()]);
    } catch { showToast("error", "Error de red al confirmar."); }
  }

  const confirmLabel = useMemo(() => {
    if (!confirmDayId) return null;
    const fromQueue = pendingRows.find((r) => r.id === confirmDayId);
    if (fromQueue) return `${fromQueue.branchCode} — ${dayLabel(fromQueue.businessDate)}`;
    const fromToday = todayCards.find((t) => t.dayId === confirmDayId);
    return fromToday ? `${fromToday.branchCode} — hoy` : null;
  }, [confirmDayId, pendingRows, todayCards]);

  const selectedHistoryDay = historyDays.find((d) => d.id === selectedHistoryDayId) ?? null;
  const forceBranch = branches.find((b) => b.id === forceBranchId) ?? null;
  const activeTodayCount = liveData?.branches.filter((b) => b.derivedState === "ACTIVE_TODAY").length ?? 0;
  const totalBlockers = liveData?.total ?? 0;
  const pendingReviewCount = liveData?.pendingReviewDaysCount ?? pendingRows.length;

  // ── Render ──
  return (
    <div className="space-y-5">
      <PageHeader
        title="Día operativo"
        description="Bitácora, no compuerta: qué espera tu firma, historial confirmado y ajustes."
      />

      {reopenTarget && (
        <Card className="border-[var(--color-warning-200)] p-4">
          <p className="text-sm font-bold text-[var(--color-text)]">Reabrir día de {reopenTarget.branchCode}</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">Escribe una nota de justificación (requerida). Solo funciona para el día de hoy.</p>
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

      {revertTarget && (
        <Card className="border-[var(--color-warning-200)] p-4">
          <p className="text-sm font-bold text-[var(--color-text)]">Revertir confirmación — {revertTarget.label}</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">El día vuelve a la cola de pendientes (PENDING). Nota requerida, queda auditado.</p>
          <textarea
            autoFocus rows={2} value={revertNote} onChange={(e) => setRevertNote(e.target.value)}
            placeholder="Motivo de la reversión…" className="hm-input mt-2 w-full text-sm"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRevertTarget(null)}>Cancelar</Button>
            <Button variant="primary" size="sm" loading={reverting} onClick={confirmRevert}>Confirmar reversión</Button>
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
            <span className="flex items-baseline gap-1.5"><b className="hm-num text-lg font-bold text-[var(--color-text)]">{activeTodayCount}</b> sucursales en curso</span>
            <span className="flex items-baseline gap-1.5"><b className={`hm-num text-lg font-bold ${totalBlockers > 0 ? "text-[var(--color-danger-700)]" : "text-[var(--color-text)]"}`}>{totalBlockers}</b> atascos genuinos</span>
            <span className="flex items-baseline gap-1.5"><b className="hm-num text-lg font-bold text-[var(--color-text)]">{pendingReviewCount}</b> esperando confirmación</span>
            <button type="button" onClick={() => setShowLifecycleInfo((v) => !v)} className="text-xs font-semibold text-[var(--color-master-600)] hover:underline">
              ¿Cómo funciona?
            </button>
            <button
              type="button"
              onClick={() => { void loadLive(); void loadPending(); }}
              className="ml-auto flex items-center gap-1.5 text-xs text-[var(--color-text-soft)] hover:text-[var(--color-text)]"
            >
              <RefreshCw style={{ width: "0.75rem", height: "0.75rem" }} />
              {timeAgo(liveUpdatedAt)}
            </button>
          </div>

          {showLifecycleInfo && (
            <Card className="space-y-2 p-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              <p>
                Un día que no se confirma <b className="text-[var(--color-text)]">nunca bloquea hoy ni se pierde</b> — cuando pasa su fecha sale de curso
                y espera en la cola <Badge variant="warning">Esperando confirmación</Badge> hasta que Master lo firme, con calma, sin caducidad.
              </p>
              <p>Sus cajas huérfanas pasan a revisión; nada se fuerza en silencio. Un ítem "en atención" no bloquea confirmar — solo pide una nota.</p>
            </Card>
          )}

          <div className="space-y-3">
            <SectionHeading title="En espera de tu confirmación" subtitle="Ordenado del más viejo al más nuevo. Esto no es una alarma — puede esperar el tiempo que haga falta." />
            {pendingRows.length === 0 ? (
              <Card className="border-dashed p-8 text-center">
                <CheckCircle2 className="mx-auto mb-2 text-[var(--color-success-600)]" style={{ width: "1.5rem", height: "1.5rem" }} />
                <p className="text-sm text-[var(--color-text-muted)]">Sin días esperando confirmación.</p>
              </Card>
            ) : (
              <div className="stagger-children space-y-2">
                {pendingRows.map((row) => (
                  <PendingRow
                    key={row.id} row={row}
                    onConfirm={openConfirm}
                    onReopen={row.daysWaiting <= 0 ? (dayId, branchCode) => { setReopenTarget({ dayId, branchCode }); setReopenNote(""); } : undefined}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <SectionHeading title="Hoy" subtitle="Días en curso · ventana 06:00 – 06:00" />
            {todayCards.length === 0 ? (
              <Card className="border-dashed p-6 text-center text-sm text-[var(--color-text-muted)]">Sin sucursales en curso hoy.</Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {todayCards.map((data) => <TodayCard key={data.branchId} data={data} onCloseDay={openConfirm} />)}
              </div>
            )}
          </div>

          {confirmDayId && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[var(--color-text)]">Revisar y confirmar{confirmLabel ? ` — ${confirmLabel}` : ""}</h2>
                <Button variant="ghost" size="sm" onClick={() => { setConfirmDayId(null); setConfirmSummary(null); setConfirmChecklist(null); }}>Cancelar</Button>
              </div>
              <OperationalDayChecklist checklist={confirmChecklist} onPreview={previewConfirm} />
              <ConfirmDayDialog
                summary={confirmSummary as never}
                checklist={confirmChecklist}
                cashDifferenceTolerance={tolerance?.defaultToleranceAmount ?? 100}
                onPreview={previewConfirm}
                onConfirm={confirmNow}
              />
            </div>
          )}
        </div>
      )}

      {/* ═══ HISTORIAL ═══════════════════════════════════════════════════════ */}
      {activeTab === "historial" && (
        <div className="space-y-3">
          <SectionHeading title="Historial" subtitle="Días confirmados. Cada uno abre su reporte — el snapshot inmutable con que se firmó." />

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
                  <p className="px-3 py-8 text-center text-sm text-[var(--color-text-muted)]">Sin días confirmados en este rango.</p>
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
                        {selectedHistoryDay.reviewedBy ? `Confirmado por ${selectedHistoryDay.reviewedBy.fullName ?? selectedHistoryDay.reviewedBy.username}` : "Confirmado"}
                      </p>
                    </div>
                    <span className="hm-chip hm-chip-info text-xs">📸 snapshot</span>
                    <Button
                      variant="ghost" size="sm" className="ml-auto text-[var(--color-warning-700)]"
                      onClick={() => { setRevertTarget({ dayId: selectedHistoryDay.id, label: `${selectedHistoryDay.branch.code} — ${dayLabel(selectedHistoryDay.businessDate)}` }); setRevertNote(""); }}
                    >
                      Revertir confirmación
                    </Button>
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
                      <div>{historyReport.lateActivity!.count} venta(s) offline sincronizó después de confirmar — se muestra aparte, no altera el número firmado.</div>
                    </div>
                  )}
                </Card>
              ) : (
                <EmptyState title="Selecciona un día" description="Elige un día confirmado de la lista para ver su reporte firmado." tone="info" />
              )}
            </div>
          </section>
        </div>
      )}

      {/* ═══ AJUSTES ═════════════════════════════════════════════════════════ */}
      {activeTab === "ajustes" && (
        <div className="space-y-3">
          <SectionHeading title="Ajustes" subtitle="Tolerancia de caja, horario de referencia y herramientas de mantenimiento." />

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-3">
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
                    <div className="hm-alert hm-alert-info">Dentro de la tolerancia → OK. Fuera → el checklist lo marca en atención y pide nota al confirmar. Nunca bloquea.</div>
                    <div className="flex justify-end">
                      <Button size="sm" onClick={saveTolerance} loading={toleranceSaving}>Guardar tolerancia</Button>
                    </div>
                  </>
                )}
              </Card>

              <Card className="space-y-3 p-4">
                <div className="hm-section-rule flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> Horario de referencia</div>
                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                  Puramente informativo — ningún horario abre ni cierra el día. Solo alimenta lo que ven cajeros y Master como referencia habitual.
                </p>
                {!schedule ? (
                  <p className="text-sm text-[var(--color-text-muted)]">Cargando…</p>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="grid gap-1 text-xs">
                        <span className="font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Apertura lun–vie</span>
                        <input type="time" className="hm-input text-sm" value={schedule.weekdayOpenTime ?? ""} onChange={(e) => setSchedule({ ...schedule, weekdayOpenTime: e.target.value || null })} />
                      </label>
                      <label className="grid gap-1 text-xs">
                        <span className="font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Apertura sábado</span>
                        <input type="time" className="hm-input text-sm" value={schedule.saturdayOpenTime ?? ""} onChange={(e) => setSchedule({ ...schedule, saturdayOpenTime: e.target.value || null })} />
                      </label>
                      <label className="grid gap-1 text-xs">
                        <span className="font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Apertura domingo</span>
                        <input type="time" className="hm-input text-sm" value={schedule.sundayOpenTime ?? ""} onChange={(e) => setSchedule({ ...schedule, sundayOpenTime: e.target.value || null })} />
                      </label>
                      <label className="grid gap-1 text-xs">
                        <span className="font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Cierre lun–vie</span>
                        <input type="time" className="hm-input text-sm" value={schedule.weekdayCloseTime ?? ""} onChange={(e) => setSchedule({ ...schedule, weekdayCloseTime: e.target.value || null })} />
                      </label>
                      <label className="grid gap-1 text-xs">
                        <span className="font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Cierre sábado</span>
                        <input type="time" className="hm-input text-sm" value={schedule.saturdayCloseTime ?? ""} onChange={(e) => setSchedule({ ...schedule, saturdayCloseTime: e.target.value || null })} />
                      </label>
                      <label className="grid gap-1 text-xs">
                        <span className="font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Cierre domingo</span>
                        <input type="time" className="hm-input text-sm" value={schedule.sundayCloseTime ?? ""} onChange={(e) => setSchedule({ ...schedule, sundayCloseTime: e.target.value || null })} />
                      </label>
                    </div>
                    <div className="flex justify-end">
                      <Button size="sm" onClick={saveSchedule} loading={scheduleSaving}>Guardar horario de referencia</Button>
                    </div>
                  </>
                )}
                <div className="hm-alert hm-alert-info">
                  La hora de corte de caja (bloqueo real de venta nocturna) se administra aparte, en{" "}
                  <a href="/app/master/settings/cash-auto-close" className="font-semibold text-[var(--color-master-600)] hover:underline">Cierre automático de cajas</a>.
                </div>
              </Card>
            </div>

            <div className="space-y-3">
              <Card className="space-y-2 p-4">
                <div className="hm-section-rule">Días que no se confirman en su fecha</div>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  <b>Pendiente, nunca bloquea</b> <Badge variant="success">siempre activo</Badge> — el día viejo pasa a la cola de confirmación; hoy abre normal; Master lo firma cuando puede, sin caducidad.
                </p>
                <div className="hm-alert hm-alert-info">Ningún proceso automático confirma un día ni vacía la cola — solo un Master real, con firma.</div>
              </Card>

              <Card className="space-y-2 p-4">
                <div className="hm-section-rule">Herramientas de fuerza</div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">Escáner de cajas atascadas. Uso excepcional, auditado.</p>
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
                        onResolved={async () => { await Promise.all([loadLive(), loadPending()]); }}
                      />
                    )}
                  </div>
                )}
              </Card>

              <Card className="space-y-1.5 p-4">
                <div className="hm-section-rule">Integridad</div>
                <div className="flex justify-between text-sm"><span className="text-[var(--color-text-muted)]">Aritmética de dinero</span><b>Decimal exacto</b></div>
                <div className="flex justify-between text-sm"><span className="text-[var(--color-text-muted)]">Reporte confirmado</span><b>Snapshot inmutable</b></div>
                <div className="flex justify-between text-sm"><span className="text-[var(--color-text-muted)]">Actividad tardía</span><b>Se muestra aparte</b></div>
                <div className="flex justify-between text-sm"><span className="text-[var(--color-text-muted)]">Día sin confirmar</span><b>Cola sin caducidad</b></div>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cola de confirmación pendiente — fila ───────────────────────────────────

function PendingRow({
  row, onConfirm, onReopen,
}: {
  row: PendingReviewDayRow;
  onConfirm: (id: string) => void;
  onReopen?: (id: string, branchCode: string) => void;
}) {
  const detail = row.attention.openOrReconcilingCashSessionsCount > 0
    ? `${row.attention.openOrReconcilingCashSessionsCount} caja(s) abierta(s)`
    : row.attention.autoClosedPendingReviewCount > 0
      ? `${row.attention.autoClosedPendingReviewCount} caja(s) sin revisar`
      : "Sin pendientes — solo falta tu firma";

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="min-w-[5rem]">
        <div className="text-sm font-bold capitalize text-[var(--color-text)]">{dayLabel(row.businessDate)}</div>
        <div className="text-xs text-[var(--color-text-soft)]">{waitingLabel(row.daysWaiting)}</div>
      </div>

      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-warning-700)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning-600)]" />
          Esperando confirmación
        </span>
        <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
          {row.branchCode} {row.branchName} · {detail}
        </p>
      </div>

      <div className="text-right">
        <div className="hm-num text-sm font-bold text-[var(--color-text)]">{money(row.expectedCashTotal)}</div>
        <div className="text-[0.625rem] text-[var(--color-text-soft)]">efectivo esperado</div>
      </div>

      <div className="flex items-center gap-1.5">
        <Button variant="primary" size="sm" onClick={() => onConfirm(row.id)}>Revisar y confirmar</Button>
        {onReopen && (
          <Button variant="ghost" size="sm" onClick={() => onReopen(row.id, row.branchCode)} className="text-[var(--color-warning-700)]">
            Reabrir
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Hoy — tarjeta compacta por sucursal en curso ────────────────────────────

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
        <Button variant="secondary" size="sm" onClick={() => onCloseDay(data.dayId)}>Confirmar día</Button>
      </div>
    </Card>
  );
}
