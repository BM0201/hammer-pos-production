"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, Archive, Building2, ScanLine,
  CheckCircle2, ChevronDown, ChevronRight, RefreshCw, Shield, TrendingUp, Zap,
} from "lucide-react";
import { OperationalDayPanel } from "@/components/operations/operational-day-panel";
import { OperationalDayScanner } from "@/components/operations/operational-day-scanner";
import { PendingCloseQueue } from "@/components/operations/pending-close-queue";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useOperationalPolling } from "@/lib/realtime/use-operational-polling";
import { showToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";

// ── Types ──────────────────────────────────────────────────────────────────────

type Branch = { id: string; code: string; name: string };

type BranchLiveStatus = {
  branchId: string;
  branchCode: string;
  branchName: string;
  businessDate: string | null;
  operationalDayId: string | null;
  operationalDayStatus: string | null;
  derivedState:
    | "NOT_OPENED_TODAY" | "OPEN_TODAY" | "CLOSING"
    | "CLOSED_PENDING_MASTER" | "APPROVED_ARCHIVED" | "CANCELLED" | "STALE_OPEN_DAY";
  blockers: {
    openCashSessions: number;
    reconcilingCashSessions: number;
    autoClosedPendingReview: number;
    staleOpenOperationalDays: number;
    staleCashSessions: number;
  };
  alerts: {
    pendingPaymentOrdersToday: number;
    pendingDispatchToday: number;
    criticalBrainOpen: number;
  };
  totalBlockers: number;
};

type LiveBlockersResponse = {
  total: number;
  branches: BranchLiveStatus[];
  computedAt: string;
};

type MasterDay = {
  id: string;
  status: string;
  businessDate: string;
  salesTotal: string | number;
  openCashSessionsCount: number;
  autoClosedPendingReviewCount: number;
  pendingDispatchCount: number;
  criticalBrainDecisionCount: number;
  approvedAt: string | null;
  approvedByMasterId: string | null;
  summaryJson?: {
    openingCashTotal?: number;
    cashTenderNetTotal?: number;
    cashMovementsNet?: number;
    cashExpensesTotal?: number;
    cashOutflowsTotal?: number;
    expectedCashOnHand?: number;
    paidSalesTotal?: number;
    pendingPaymentTotal?: number;
    cancelledSalesTotal?: number;
    postedPaymentsCount?: number;
    voidedPaymentsCount?: number;
  } | null;
  branch: Branch;
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

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Abierto", CLOSING: "En cierre", CLOSED: "Cerrado", CANCELLED: "Cancelado",
  REOPENED_FOR_ADJUSTMENT: "Reabierto (ajuste)",
};
const STATUS_BADGE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  OPEN: "success", CLOSING: "warning", CLOSED: "neutral", CANCELLED: "danger",
  REOPENED_FOR_ADJUSTMENT: "warning",
};

const DERIVED_LABEL: Record<string, string> = {
  NOT_OPENED_TODAY:     "No abierto hoy",
  OPEN_TODAY:           "Abierto hoy",
  CLOSING:              "En cierre",
  CLOSED_PENDING_MASTER:"Pendiente aprobación",
  APPROVED_ARCHIVED:    "Aprobado",
  CANCELLED:            "Cancelado",
  STALE_OPEN_DAY:       "Abierto (día anterior)",
};

const DERIVED_BADGE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  NOT_OPENED_TODAY:     "neutral",
  OPEN_TODAY:           "success",
  CLOSING:              "warning",
  CLOSED_PENDING_MASTER:"warning",
  APPROVED_ARCHIVED:    "success",
  CANCELLED:            "danger",
  STALE_OPEN_DAY:       "danger",
};

// ── Main page ──────────────────────────────────────────────────────────────────

export default function MasterOperationsPage() {
  const [branches, setBranches]         = useState<Branch[]>([]);
  const [liveData, setLiveData]         = useState<LiveBlockersResponse | null>(null);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<Date | null>(null);

  // Bandeja Master
  const [pendingDays, setPendingDays]   = useState<MasterDay[]>([]);
  const [pendingRefreshing, setPendingRefreshing] = useState(false);
  const [approvingId, setApprovingId]   = useState<string | null>(null);
  const [reopeningId, setReopeningId]   = useState<string | null>(null);
  const [reopenTarget, setReopenTarget] = useState<{ dayId: string; branchCode: string; wasApproved: boolean } | null>(null);
  const [reopenNote, setReopenNote]     = useState("");

  // Biblioteca
  const [archivedDays, setArchivedDays] = useState<MasterDay[]>([]);
  const [archiveRefreshing, setArchiveRefreshing] = useState(false);
  const [showArchive, setShowArchive]   = useState(false);
  const today = new Date().toISOString().split("T")[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(sevenDaysAgo);
  const [dateTo, setDateTo]     = useState(today);
  const [archiveBranch, setArchiveBranch] = useState("");

  // 360 panel
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const selectedBranch = useMemo(() => branches.find((b) => b.id === selectedBranchId) ?? null, [branches, selectedBranchId]);

  // Force cleanup (triggered from a branch row)
  const [cleanupBranchId, setCleanupBranchId] = useState<string | null>(null);
  const cleanupBranch = useMemo(() => branches.find((b) => b.id === cleanupBranchId) ?? null, [branches, cleanupBranchId]);

  // Global scanner (dedicated section — pick any branch and scan)
  const [scanBranchId, setScanBranchId] = useState<string>("");
  const scanBranch = useMemo(() => branches.find((b) => b.id === scanBranchId) ?? null, [branches, scanBranchId]);

  // Día Operativo v2 — picker de 5 vistas (hammer-dia-operativo-mockup.html).
  const [activeTab, setActiveTab] = useState<"ciclo" | "cerrar" | "pendientes" | "reporte" | "config">("ciclo");
  const [closeBranchId, setCloseBranchId] = useState("");
  const closeBranch = useMemo(() => branches.find((b) => b.id === closeBranchId) ?? null, [branches, closeBranchId]);
  const [reportBranchId, setReportBranchId] = useState("");
  const reportBranch = useMemo(() => branches.find((b) => b.id === reportBranchId) ?? null, [branches, reportBranchId]);

  // ── Load branches once ──
  useEffect(() => {
    apiFetch("/api/branches")
      .then((r) => r.json())
      .then((raw) => setBranches(unwrapApiData(raw) as Branch[]))
      .catch(() => showToast("error", "No se pudieron cargar sucursales."));
  }, []);

  // ── Load live blockers ──
  const loadLive = useCallback(async () => {
    try {
      const resp = await apiFetch("/api/master/operations/live-blockers");
      const raw = await resp.json();
      if (resp.ok) { setLiveData(unwrapApiData(raw) as LiveBlockersResponse); setLiveUpdatedAt(new Date()); }
    } catch { /* silent refresh */ }
  }, []);

  useOperationalPolling({ task: loadLive, intervalMs: 30_000, deps: [loadLive] });

  // ── Load pending days (Bandeja Master) ──
  const loadPending = useCallback(async () => {
    setPendingRefreshing(true);
    try {
      const resp = await apiFetch("/api/master/operations?reviewState=pending");
      const raw = await resp.json();
      if (resp.ok) setPendingDays(unwrapApiData(raw) as MasterDay[]);
      else showToast("error", raw?.error?.message ?? "Error cargando bandeja.");
    } finally { setPendingRefreshing(false); }
  }, []);

  useOperationalPolling({ task: loadPending, intervalMs: 30_000, deps: [loadPending] });

  // ── Load archived days (Biblioteca) ──
  const loadArchive = useCallback(async () => {
    setArchiveRefreshing(true);
    try {
      const params = new URLSearchParams({ reviewState: "approved" });
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo)   params.set("dateTo",   dateTo);
      if (archiveBranch) params.set("branchId", archiveBranch);
      const resp = await apiFetch(`/api/master/operations?${params.toString()}`);
      const raw = await resp.json();
      if (resp.ok) setArchivedDays(unwrapApiData(raw) as MasterDay[]);
      else showToast("error", raw?.error?.message ?? "Error cargando biblioteca.");
    } finally { setArchiveRefreshing(false); }
  }, [dateFrom, dateTo, archiveBranch]);

  useEffect(() => { if (showArchive) void loadArchive(); }, [showArchive, loadArchive]);

  // ── Actions ──
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
      await loadPending();
      await loadLive();
    } catch { showToast("error", "Error de red al aprobar."); }
    finally { setApprovingId(null); }
  }

async function confirmReopenDay(dayId: string, branchCode: string, note: string, onDone: () => Promise<void>, setReopeningId: (id: string | null) => void) {
    if (!note.trim()) { showToast("warning", "La nota es requerida."); return; }
    setReopeningId(dayId);
    try {
      const resp = await apiFetch(`/api/master/operations/${dayId}/reopen`, {
        method: "POST",
        body: JSON.stringify({ note: note.trim() }),
      });
      const raw = await resp.json();
      if (!resp.ok) { showToast("error", `${branchCode}: ${raw?.error?.message ?? "No se pudo reabrir."}`); return; }
      showToast("success", `Día de ${branchCode} reabierto.`);
      await onDone();
    } catch { showToast("error", "Error de red al reabrir."); }
    finally { setReopeningId(null); }
  }

  // ── Derived KPIs ──
  const totalBlockers  = liveData?.total ?? 0;
  const pendingApproval = pendingDays.length;
  const pendingSales   = pendingDays.reduce((s, d) => s + Number(d.summaryJson?.paidSalesTotal ?? d.salesTotal), 0);

  // ── Render ──
  return (
    <div className="space-y-6">
      <PageHeader
        title="Operación Global"
        description="Control en tiempo real: estado de sucursales, días pendientes y biblioteca histórica."
        breadcrumbs={[{ label: "Master", href: "/app/master" }, { label: "Día Operativo 360" }]}
      />

      {reopenTarget && (
        <Card className="border-[var(--color-warning-200)] p-4">
          <p className="text-sm font-bold text-[var(--color-text)]">
            Reabrir día de {reopenTarget.branchCode}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {reopenTarget.wasApproved
              ? "Este día ya fue aprobado. Escribe una nota de justificación."
              : "Escribe una nota para reabrir el día (requerido)."}
          </p>
          <textarea
            autoFocus
            rows={2}
            value={reopenNote}
            onChange={(e) => setReopenNote(e.target.value)}
            placeholder="Motivo de la reapertura…"
            className="hm-input mt-2 w-full text-sm"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setReopenTarget(null)}>Cancelar</Button>
            <Button
              variant="primary"
              size="sm"
              loading={reopeningId === reopenTarget.dayId}
              onClick={async () => {
                await confirmReopenDay(reopenTarget.dayId, reopenTarget.branchCode, reopenNote, async () => { await loadPending(); await loadArchive(); }, setReopeningId);
                setReopenTarget(null);
              }}
            >
              Confirmar reapertura
            </Button>
          </div>
        </Card>
      )}

      <div className="erp-tabs-pill w-fit">
        {([
          ["ciclo", "1 · Estado y ciclo"],
          ["cerrar", "2 · Cerrar el día"],
          ["pendientes", "3 · Cierres pendientes"],
          ["reporte", "4 · Reporte del día"],
          ["config", "5 · Configuración"],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" data-active={activeTab === key} onClick={() => setActiveTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === "ciclo" && <OperationalDayLifecycleDiagram />}

      {/* ═══ SECTION 1: Estado Actual ═══════════════════════════════════════ */}
      {activeTab === "ciclo" && (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="text-[var(--color-text-muted)]" style={{ width: "0.875rem", height: "0.875rem" }} />
          <h2 className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            Estado Actual — Tiempo Real
          </h2>
          <span className="text-[0.625rem] text-[var(--color-text-muted)]">{timeAgo(liveUpdatedAt)}</span>
          <button type="button" onClick={loadLive} className="ml-auto text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <RefreshCw style={{ width: "0.75rem", height: "0.75rem" }} />
          </button>
        </div>

        <div className="hm-kpi-grid">
          <KpiCard
            label="Bloqueos operativos"
            value={totalBlockers}
            tone={totalBlockers > 0 ? "alert" : "ok"}
            roleAccent="MASTER"
            helper={totalBlockers > 0 ? "Cajas/días atascados — requieren acción" : "Sin bloqueos activos"}
          />
          <KpiCard
            label="Días pendientes de aprobación"
            value={pendingApproval}
            tone={pendingApproval > 0 ? "ok" : "default"}
            roleAccent="MASTER"
            helper={pendingApproval > 0 ? "Días CLOSED listos para aprobar" : "Sin días en espera"}
          />
          <KpiCard
            label="Ventas (pendientes aprobación)"
            value={money(pendingSales)}
            tone="ok"
            roleAccent="MASTER"
            helper="Suma de días en Bandeja Master"
          />
        </div>

        {/* Per-branch live status */}
        {liveData && liveData.branches.length > 0 && (
          <Card className="overflow-x-auto">
            <table className="hm-table w-full text-left text-xs">
              <thead className="text-[0.6875rem] uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="py-2">Sucursal</th>
                  <th>Estado del día</th>
                  <th className="text-center">Bloqueos</th>
                  <th className="text-center">Cajas abiertas</th>
                  <th className="text-center">Auto-cerradas</th>
                  <th className="text-center">Días atascados</th>
                  <th className="text-center">Alertas</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {liveData.branches.map((b) => (
                  <tr key={b.branchId} className="border-t border-[var(--color-border)]">
                    <td className="py-2 font-semibold text-[var(--color-text)]">
                      <button
                        type="button"
                        className="hover:underline text-left text-[var(--color-info-700)]"
                        onClick={() => setSelectedBranchId(selectedBranchId === b.branchId ? "" : b.branchId)}
                      >
                        {b.branchCode}
                      </button>
                      <span className="ml-1 hidden text-[var(--color-text-muted)] xl:inline">{b.branchName}</span>
                    </td>
                    <td>
                      <Badge variant={DERIVED_BADGE[b.derivedState] ?? "neutral"}>
                        {DERIVED_LABEL[b.derivedState] ?? b.derivedState}
                      </Badge>
                    </td>
                    <td className="text-center">
                      {b.totalBlockers > 0 ? (
                        <span className="font-bold text-[var(--color-danger-700)]">{b.totalBlockers}</span>
                      ) : (
                        <CheckCircle2 className="mx-auto text-[var(--color-success-600)]" style={{ width: "0.875rem", height: "0.875rem" }} />
                      )}
                    </td>
                    <td className="text-center">{b.blockers.openCashSessions || "—"}</td>
                    <td className="text-center">{b.blockers.autoClosedPendingReview || "—"}</td>
                    <td className="text-center">{b.blockers.staleOpenOperationalDays || "—"}</td>
                    <td className="text-center text-[var(--color-text-secondary)]">
                      {b.alerts.pendingPaymentOrdersToday + b.alerts.pendingDispatchToday + b.alerts.criticalBrainOpen || "—"}
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button" variant="ghost" size="sm"
                          onClick={() => setSelectedBranchId(selectedBranchId === b.branchId ? "" : b.branchId)}
                          className="text-xs"
                        >
                          {selectedBranchId === b.branchId ? "Ocultar" : "Ver 360"}
                        </Button>
                        {b.totalBlockers > 0 && (
                          <Button
                            type="button" variant="ghost" size="sm"
                            onClick={() => setCleanupBranchId(cleanupBranchId === b.branchId ? null : b.branchId)}
                            className="text-xs text-[var(--color-warning-700)]"
                            icon={<Zap style={{ width: "0.7rem", height: "0.7rem" }} />}
                          >
                            Limpiar
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {/* Force Cleanup / scanner panel */}
        {cleanupBranchId && cleanupBranch && (
          <OperationalDayScanner
            branchId={cleanupBranchId}
            branchCode={cleanupBranch.code}
            onClose={() => setCleanupBranchId(null)}
            onResolved={async () => { await loadLive(); await loadPending(); }}
          />
        )}

        {/* 360 panel */}
        {selectedBranch && selectedBranchId && (
          <div>
            <p className="mb-2 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted)] flex items-center gap-1.5">
              <TrendingUp style={{ width: "0.75rem", height: "0.75rem" }} />
              Vista 360 — {selectedBranch.code}: {selectedBranch.name}
            </p>
            <OperationalDayPanel branchId={selectedBranchId} masterMode />
          </div>
        )}
      </section>
      )}

      {/* ═══ SECTION 1.5: Escáner y cierre forzado ══════════════════════════ */}
      {activeTab === "ciclo" && (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ScanLine className="text-[var(--color-text-muted)]" style={{ width: "0.875rem", height: "0.875rem" }} />
          <h2 className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            Escáner y Cierre Forzado
          </h2>
        </div>

        <Card className="p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1">
              <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide flex items-center gap-1">
                <Building2 style={{ width: "0.75rem", height: "0.75rem" }} />
                Sucursal a escanear
              </span>
              <select
                className="hm-input rounded-lg text-sm"
                value={scanBranchId}
                onChange={(e) => setScanBranchId(e.target.value)}
              >
                <option value="">Selecciona una sucursal…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                ))}
              </select>
            </label>
            <p className="flex-1 min-w-[12rem] text-[0.6875rem] leading-snug text-[var(--color-text-muted)]">
              Escanea el día operativo de una sucursal para detectar cierres pendientes, cajas atascadas o días sin
              cerrar. El escáner te dirá cuál es el problema y podrás forzar y actualizar el cierre desde aquí.
            </p>
          </div>
        </Card>

        {scanBranchId && scanBranch && (
          <OperationalDayScanner
            key={scanBranchId}
            branchId={scanBranchId}
            branchCode={scanBranch.code}
            onResolved={async () => { await loadLive(); await loadPending(); }}
          />
        )}
      </section>
      )}

      {/* ═══ Vista 2 · Cerrar el día ═══════════════════════════════════════ */}
      {activeTab === "cerrar" && (
        <section className="space-y-3">
          <div className="hm-alert hm-alert-info">
            El cierre ya es sólido (reclamo atómico, checklist, snapshot). Los totales se suman en <b>decimales exactos</b> (Fase 1) y el <b>modo de fuente</b> (operationalDayId / MIXTO / legacy) se muestra antes de firmar.
          </div>
          <Card className="p-3">
            <label className="grid gap-1 sm:w-72">
              <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Sucursal</span>
              <select className="hm-input rounded-lg text-sm" value={closeBranchId} onChange={(e) => setCloseBranchId(e.target.value)}>
                <option value="">Selecciona una sucursal…</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
            </label>
          </Card>
          {closeBranchId && closeBranch && <OperationalDayPanel key={closeBranchId} branchId={closeBranchId} masterMode />}
        </section>
      )}

      {/* ═══ Vista 3 · Cierres pendientes (Fase 5.5) ══════════════════════ */}
      {activeTab === "pendientes" && <PendingCloseQueue isMaster onResolved={async () => { await loadLive(); }} />}

      {/* ═══ Vista 4 · Reporte del día ══════════════════════════════════════ */}
      {activeTab === "reporte" && (
        <section className="space-y-3">
          <div className="hm-alert hm-alert-info">
            El reporte de un día cerrado es el que se firmó, no uno recalculado (Fase 4) — lee el <b>snapshot inmutable</b>, y la actividad tardía (ventas offline sincronizadas después del cierre) se muestra aparte.
          </div>
          <Card className="p-3">
            <label className="grid gap-1 sm:w-72">
              <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Sucursal</span>
              <select className="hm-input rounded-lg text-sm" value={reportBranchId} onChange={(e) => setReportBranchId(e.target.value)}>
                <option value="">Selecciona una sucursal…</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
            </label>
            <p className="mt-2 text-[11.5px] text-[var(--color-text-muted)]">Usa &quot;Ver reporte del día&quot; abajo para el snapshot firmado (o en vivo si el día sigue abierto) y la actividad tardía.</p>
          </Card>
          {reportBranchId && reportBranch && <OperationalDayPanel key={reportBranchId} branchId={reportBranchId} masterMode />}
        </section>
      )}

      {/* ═══ Vista 5 · Configuración ══════════════════════════════════════ */}
      {activeTab === "config" && <OperationalDayConfigTab branches={branches} />}

      {/* ═══ SECTION 2: Bandeja Master ═══════════════════════════════════════ */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="text-[var(--color-text-muted)]" style={{ width: "0.875rem", height: "0.875rem" }} />
          <h2 className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            Bandeja Master — Pendientes de aprobación
          </h2>
          <span className="hm-chip hm-chip-warning text-xs">{pendingDays.length}</span>
          <button type="button" onClick={loadPending} className="ml-auto text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <RefreshCw style={{ width: "0.75rem", height: "0.75rem" }} className={pendingRefreshing ? "animate-spin" : ""} />
          </button>
        </div>

        <Card className="overflow-x-auto">
          <table className="hm-table w-full text-left text-sm">
            <thead className="text-xs uppercase text-[var(--color-text-muted)]">
              <tr>
                <th className="py-2">Sucursal</th>
                <th>Fecha</th>
                <th>Estado</th>
                <th className="text-right">Ventas</th>
                <th className="text-right">Gastos</th>
                <th className="text-right">Efectivo esp.</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pendingDays.map((day) => (
                <tr key={day.id} className="border-t border-[var(--color-border)]">
                  <td className="py-2.5 font-semibold text-[var(--color-info-700)]">
                    {day.branch.code}
                    <span className="ml-1.5 hidden text-xs font-normal text-[var(--color-text-muted)] xl:inline">{day.branch.name}</span>
                  </td>
                  <td className="text-[var(--color-text-secondary)]">
                    {new Date(day.businessDate).toLocaleDateString("es-NI", { timeZone: "UTC" })}
                  </td>
                  <td>
                    <Badge variant={STATUS_BADGE[day.status] ?? "neutral"}>
                      {STATUS_LABEL[day.status] ?? day.status}
                    </Badge>
                  </td>
                  <td className="text-right font-semibold">{money(day.summaryJson?.paidSalesTotal ?? day.salesTotal)}</td>
                  <td className="text-right text-[var(--color-danger-700)]">
                    {(day.summaryJson?.cashOutflowsTotal ?? 0) > 0 ? `- ${money(day.summaryJson?.cashOutflowsTotal)}` : money(0)}
                  </td>
                  <td className="text-right">{money(day.summaryJson?.expectedCashOnHand ?? 0)}</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {day.status === "CLOSED" && !day.approvedAt && (
                        <Button
                          type="button" variant="primary" size="sm"
                          loading={approvingId === day.id}
                          onClick={() => approveDay(day.id, day.branch.code)}
                          icon={<CheckCircle2 className="h-3 w-3" />}
                          className="text-xs"
                        >
                          Aprobar
                        </Button>
                      )}
                      {day.status === "CLOSED" && (
                        <Button
                          type="button" variant="ghost" size="sm"
                          loading={reopeningId === day.id}
                          onClick={() => { setReopenTarget({ dayId: day.id, branchCode: day.branch.code, wasApproved: !!day.approvedAt }); setReopenNote(""); }}
                          className="text-xs text-[var(--color-warning-700)]"
                        >
                          Reabrir
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {pendingDays.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-[var(--color-text-muted)]">
                    <CheckCircle2 className="mx-auto mb-1.5 text-[var(--color-success-600)]" style={{ width: "1.25rem", height: "1.25rem" }} />
                    Sin días pendientes de aprobación.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </section>

      {/* ═══ SECTION 3: Biblioteca / Historial ═══════════════════════════════ */}
      <section className="space-y-3">
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left"
          onClick={() => setShowArchive((v) => !v)}
        >
          <Archive className="text-[var(--color-text-muted)]" style={{ width: "0.875rem", height: "0.875rem" }} />
          <h2 className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            Biblioteca — Días aprobados
          </h2>
          {showArchive
            ? <ChevronDown style={{ width: "0.75rem", height: "0.75rem" }} className="ml-auto text-[var(--color-text-muted)]" />
            : <ChevronRight style={{ width: "0.75rem", height: "0.75rem" }} className="ml-auto text-[var(--color-text-muted)]" />}
        </button>

        {showArchive && (
          <>
            {/* Filters */}
            <Card className="p-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1">
                  <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Desde</span>
                  <input type="date" className="hm-input rounded-lg text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </label>
                <label className="grid gap-1">
                  <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Hasta</span>
                  <input type="date" className="hm-input rounded-lg text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </label>
                <label className="grid gap-1">
                  <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide flex items-center gap-1">
                    <Building2 style={{ width: "0.75rem", height: "0.75rem" }} />
                    Sucursal
                  </span>
                  <select className="hm-input rounded-lg text-sm" value={archiveBranch} onChange={(e) => setArchiveBranch(e.target.value)}>
                    <option value="">Todas</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                  </select>
                </label>
                <Button variant="secondary" size="sm" loading={archiveRefreshing} onClick={loadArchive} icon={<RefreshCw className="h-3.5 w-3.5" />}>
                  Buscar
                </Button>
              </div>
            </Card>

            <Card className="overflow-x-auto">
              <table className="hm-table w-full text-left text-sm">
                <thead className="text-xs uppercase text-[var(--color-text-muted)]">
                  <tr>
                    <th className="py-2">Sucursal</th>
                    <th>Fecha</th>
                    <th>Estado</th>
                    <th className="text-right">Ventas</th>
                    <th className="text-right">Gastos</th>
                    <th className="text-right">Efectivo esp.</th>
                    <th className="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {archivedDays.map((day) => (
                    <tr key={day.id} className="border-t border-[var(--color-border)]">
                      <td className="py-2.5 font-semibold text-[var(--color-text)]">
                        {day.branch.code}
                        <span className="ml-1.5 hidden text-xs font-normal text-[var(--color-text-muted)] xl:inline">{day.branch.name}</span>
                      </td>
                      <td className="text-[var(--color-text-secondary)]">
                        {new Date(day.businessDate).toLocaleDateString("es-NI", { timeZone: "UTC" })}
                      </td>
                      <td><Badge variant="success">Aprobado</Badge></td>
                      <td className="text-right font-semibold">{money(day.summaryJson?.paidSalesTotal ?? day.salesTotal)}</td>
                      <td className="text-right text-[var(--color-danger-700)]">
                        {(day.summaryJson?.cashOutflowsTotal ?? 0) > 0 ? `- ${money(day.summaryJson?.cashOutflowsTotal)}` : money(0)}
                      </td>
                      <td className="text-right">{money(day.summaryJson?.expectedCashOnHand ?? 0)}</td>
                      <td className="text-right">
                        {day.status === "CLOSED" && (
                          <Button
                            type="button" variant="ghost" size="sm"
                            loading={reopeningId === day.id}
                            onClick={() => { setReopenTarget({ dayId: day.id, branchCode: day.branch.code, wasApproved: true }); setReopenNote(""); }}
                            className="text-xs text-[var(--color-warning-700)]"
                          >
                            Reabrir
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {archivedDays.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-sm text-[var(--color-text-muted)]">
                        Sin días aprobados en este rango.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </section>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Vista 1 · Diagrama de ciclo de vida (hammer-dia-operativo-mockup.html)
   ═══════════════════════════════════════════════════════════════════════ */

type LifecycleNode = { label: string; desc: string; dot: string; border: string; bg?: string };

const NORMAL_PATH: LifecycleNode[] = [
  { label: "Sin día", desc: "Nadie ha abierto caja. La primera caja del día lo auto-abre.", dot: "var(--color-text-soft)", border: "var(--color-border-strong)" },
  { label: "Abierto", desc: "Ventas, pagos y cajas se asientan aquí. Ventana 06:00 – 06:00 Managua.", dot: "var(--color-success-500)", border: "var(--color-success-200)" },
  { label: "Cerrado", desc: "Se congela un snapshot inmutable. Requiere checklist sin bloqueos.", dot: "var(--color-master-500)", border: "var(--color-master-200)" },
  { label: "Aprobado", desc: "El Master valida el cierre. El día queda firme y archivado.", dot: "var(--color-info-500)", border: "var(--color-info-200)" },
];

const BRANCH_PATH: LifecycleNode[] = [
  { label: "Abierto (ayer)", desc: "Pasó la medianoche operativa sin cerrarse.", dot: "var(--color-success-500)", border: "var(--color-success-200)" },
  { label: "Pendiente de cierre", desc: "Sale de «abierto» — deja de bloquear. Sus cajas huérfanas pasan a revisión. Entra a la cola.", dot: "var(--color-warning-600)", border: "var(--color-warning-200)", bg: "var(--color-warning-50)" },
  { label: "Cerrado (tardío)", desc: "El Master lo concilia cuando puede, con la fecha y ventana de ese día, no la de hoy.", dot: "var(--color-master-500)", border: "var(--color-master-200)" },
];

function LifecycleRow({ nodes }: { nodes: LifecycleNode[] }) {
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {nodes.map((n, i) => (
        <div key={n.label} className="flex flex-1 items-stretch gap-2" style={{ minWidth: 150 }}>
          <div className="flex-1 rounded-xl border bg-[var(--color-surface)] p-3" style={{ borderColor: n.border, background: n.bg }}>
            <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-[var(--color-text)]">
              <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: n.dot }} />
              {n.label}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-[var(--color-text-muted)]">{n.desc}</p>
          </div>
          {i < nodes.length - 1 && (
            <div className="hidden flex-shrink-0 items-center text-[var(--color-text-soft)] sm:flex">→</div>
          )}
        </div>
      ))}
    </div>
  );
}

function OperationalDayLifecycleDiagram() {
  return (
    <Card className="space-y-4 p-4">
      <p className="text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">
        <b className="text-[var(--color-text)]">Un día operativo tiene un solo camino, y se entiende de un vistazo.</b>{" "}
        Lo clave: si un día no se cierra en su fecha, <b className="text-[var(--color-text)]">no queda bloqueando ni se pierde</b> — pasa a{" "}
        <Badge variant="warning">Pendiente de cierre</Badge> y se va a una cola. Hoy abre siempre, normal. El día pendiente espera, intacto, a que el Master lo concilie con calma.
      </p>

      <div className="hm-section-rule">Camino normal</div>
      <LifecycleRow nodes={NORMAL_PATH} />

      <p className="text-[11px] text-[var(--color-text-soft)]">↓ ¿y si nadie lo cierra en su fecha?</p>

      <div className="rounded-xl border border-dashed border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3">
        <LifecycleRow nodes={BRANCH_PATH} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-[var(--color-danger-200)] bg-[var(--color-surface)] p-3">
          <p className="mb-1 text-[12px] font-bold text-[var(--color-danger-700)]">Antes (el problema)</p>
          <p className="text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
            El día viejo quedaba <b className="text-[var(--color-text-secondary)]">Abierto</b> para siempre. El auto-cierre solo tocaba el día de hoy; al viejo lo registraba como error en cada corrida y lo dejaba ahí. Y{" "}
            <b className="text-[var(--color-text-secondary)]">bloqueaba la sucursal</b>: no se podía abrir caja ni vender sin un override que mezclaba las ventas de hoy con el día de ayer.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--color-success-200)] bg-[var(--color-surface)] p-3">
          <p className="mb-1 text-[12px] font-bold text-[var(--color-success-700)]">Ahora (la lógica)</p>
          <p className="text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
            El día viejo pasa a <b className="text-[var(--color-text-secondary)]">Pendiente de cierre</b> y sale del camino. Como la apertura busca días &quot;abiertos&quot;,{" "}
            <b className="text-[var(--color-text-secondary)]">hoy abre solo</b>. El viejo espera en la cola, con toda su data. Nada se force-cierra en silencio; nada se pierde; la sucursal nunca se traba.
          </p>
        </div>
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Vista 5 · Configuración (tolerancia por sucursal + política de pendientes)
   ═══════════════════════════════════════════════════════════════════════ */

type CashToleranceConfig = { defaultToleranceAmount: number; byBranch: Record<string, number> };

function OperationalDayConfigTab({ branches }: { branches: Branch[] }) {
  const [tolerance, setTolerance] = useState<CashToleranceConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/master/operations/cash-tolerance-config")
      .then((r) => r.json())
      .then((raw) => { if (!cancelled) setTolerance(unwrapApiData(raw) as CashToleranceConfig); })
      .catch(() => showToast("error", "No se pudo cargar la tolerancia de caja."));
    return () => { cancelled = true; };
  }, []);

  async function save() {
    if (!tolerance) return;
    setSaving(true);
    try {
      const resp = await apiFetch("/api/master/operations/cash-tolerance-config", { method: "PUT", body: JSON.stringify(tolerance) });
      const raw = await resp.json();
      if (!resp.ok) { showToast("error", raw?.error?.message ?? "No se pudo guardar."); return; }
      setTolerance(unwrapApiData(raw) as CashToleranceConfig);
      showToast("success", "Tolerancia de caja guardada.");
    } catch {
      showToast("error", "Error de red al guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid gap-3 lg:grid-cols-2">
      <Card className="space-y-3 p-4">
        <div className="hm-section-rule">Tolerancia de diferencia de caja</div>
        {!tolerance ? (
          <p className="text-sm text-[var(--color-text-muted)]">Cargando…</p>
        ) : (
          <>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-[var(--color-text-secondary)]">Default global (C$)</span>
              <input
                type="number" min="0" step="0.01"
                value={tolerance.defaultToleranceAmount}
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
                      type="number" min="0" step="0.01"
                      value={tolerance.byBranch[b.id] ?? tolerance.defaultToleranceAmount}
                      onChange={(e) => setTolerance({ ...tolerance, byBranch: { ...tolerance.byBranch, [b.id]: Number(e.target.value) || 0 } })}
                      className="hm-input w-28 font-mono"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="hm-alert hm-alert-info">
              💡 Dentro de la tolerancia → advertencia (no bloquea). Fuera → exige revisión/justificación.
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={save} loading={saving}>Guardar tolerancia</Button>
            </div>
          </>
        )}
      </Card>

      <div className="space-y-3">
        <Card className="space-y-2 p-4">
          <div className="hm-section-rule">Día de negocio</div>
          <div className="flex justify-between text-sm"><span className="text-[var(--color-text-muted)]">Zona horaria</span><b>America/Managua</b></div>
          <div className="flex justify-between text-sm"><span className="text-[var(--color-text-muted)]">Hora de corte</span><b>06:00 — venta a las 02:00 = día anterior</b></div>
        </Card>

        <Card className="space-y-2 border-[var(--color-warning-200)] p-4">
          <div className="hm-section-rule">Días pendientes de cierre</div>
          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
            <b>Pendiente, nunca bloquea</b> <Badge variant="warning">recomendado, siempre activo</Badge> — el día viejo pasa a la cola; hoy abre normal; el Master lo cierra cuando puede.
          </p>
          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
            El toggle <b>&quot;Cierre automático del día&quot;</b> en{" "}
            <Link href="/app/master/settings/operational-automation" className="font-semibold text-[var(--color-master-600)] hover:underline">Automatización Operativa</Link>{" "}
            sigue disponible como alternativa opcional (cierra hoy mismo al pasar la hora de corte, si no tiene cajas abiertas) — pero nunca reemplaza la regla de fondo.
          </p>
          <div className="hm-alert hm-alert-warning">
            ⚠ Nunca se force-cierra un día viejo con cajas abiertas en silencio: eso perdería el conteo físico. Siempre pasa por la cola.
          </div>
        </Card>

        <Card className="space-y-1.5 p-4">
          <div className="hm-section-rule">Integridad</div>
          <div className="flex justify-between text-sm"><span className="text-[var(--color-text-muted)]">Aritmética de dinero</span><b>Decimal exacto</b></div>
          <div className="flex justify-between text-sm"><span className="text-[var(--color-text-muted)]">Reporte de día cerrado</span><b>Snapshot inmutable</b></div>
          <div className="flex justify-between text-sm"><span className="text-[var(--color-text-muted)]">Actividad tardía</span><b>Se muestra aparte</b></div>
          <div className="flex justify-between text-sm"><span className="text-[var(--color-text-muted)]">Día sin cerrar</span><b>Cola de pendientes</b></div>
        </Card>
      </div>
    </section>
  );
}
