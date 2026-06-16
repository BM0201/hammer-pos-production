"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, Archive, Building2,
  CheckCircle2, ChevronDown, ChevronRight, RefreshCw, Shield, TrendingUp, Zap,
} from "lucide-react";
import { OperationalDayPanel } from "@/components/operations/operational-day-panel";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
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
    expectedCashOnHand?: number;
    paidSalesTotal?: number;
    pendingPaymentTotal?: number;
    cancelledSalesTotal?: number;
    postedPaymentsCount?: number;
    voidedPaymentsCount?: number;
  } | null;
  branch: Branch;
};

type ForceCleanupDiagnosis = {
  staleOpenCashSessions: Array<{ id: string; openedAt: string; physicalCashBoxCode: string; businessDate: string | null }>;
  autoClosedPendingReviewSessions: Array<{ id: string; autoClosedAt: string | null; physicalCashBoxCode: string; expectedCashAmount: number | null }>;
  staleOpenOperationalDays: Array<{ id: string; businessDate: string; status: string }>;
  todayDayId: string | null;
};

type ForceCleanupResult = {
  mode: "DRY_RUN" | "EXECUTE";
  branchId: string;
  diagnosis: ForceCleanupDiagnosis;
  actionsTaken: string[];
  errors: string[];
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
};
const STATUS_BADGE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  OPEN: "success", CLOSING: "warning", CLOSED: "neutral", CANCELLED: "danger",
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

// ── Force Cleanup Panel ────────────────────────────────────────────────────────

function ForceCleanupPanel({
  branchId,
  branchCode,
  onClose,
  onDone,
}: {
  branchId: string;
  branchCode: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"idle" | "diagnosing" | "diagnosed" | "executing" | "done">("idle");
  const [diagnosis, setDiagnosis] = useState<ForceCleanupDiagnosis | null>(null);
  const [result, setResult] = useState<ForceCleanupResult | null>(null);
  const [note, setNote] = useState("");
  const [actions, setActions] = useState({
    closeStaleOpenCashSessions: true,
    resolveAutoClosedPendingReview: true,
    closeStaleOperationalDay: true,
    refreshOperationalDaySummaries: true,
  });

  const anyActionSelected = Object.values(actions).some(Boolean);

  async function runDryRun() {
    setStep("diagnosing");
    try {
      const resp = await apiFetch("/api/master/operations/force-cleanup", {
        method: "POST",
        body: JSON.stringify({ branchId, mode: "DRY_RUN", note: "", actions }),
      });
      const raw = await resp.json();
      if (!resp.ok) { showToast("error", raw?.error?.message ?? "Error en diagnóstico."); setStep("idle"); return; }
      const data = unwrapApiData(raw) as ForceCleanupResult;
      setDiagnosis(data.diagnosis);
      setStep("diagnosed");
    } catch { showToast("error", "Error de red."); setStep("idle"); }
  }

  async function runExecute() {
    if (!note.trim()) { showToast("warning", "La nota es requerida para ejecutar."); return; }
    setStep("executing");
    try {
      const resp = await apiFetch("/api/master/operations/force-cleanup", {
        method: "POST",
        body: JSON.stringify({ branchId, mode: "EXECUTE", note: note.trim(), actions }),
      });
      const raw = await resp.json();
      if (!resp.ok) { showToast("error", raw?.error?.message ?? "Error al ejecutar."); setStep("diagnosed"); return; }
      const data = unwrapApiData(raw) as ForceCleanupResult;
      setResult(data);
      setStep("done");
      if (data.errors.length === 0) showToast("success", `Limpieza completada en ${branchCode}.`);
      else showToast("warning", `Completado con ${data.errors.length} error(es). Revisa los detalles.`);
      onDone();
    } catch { showToast("error", "Error de red."); setStep("diagnosed"); }
  }

  return (
    <div className="rounded-xl border border-[var(--color-warning-300)] bg-[color-mix(in_srgb,var(--color-warning-50)_40%,white)] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="text-[var(--color-warning-700)]" style={{ width: "1rem", height: "1rem" }} />
          <span className="text-sm font-bold text-[var(--color-warning-900)]">
            Limpieza Forzada — {branchCode}
          </span>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancelar</button>
      </div>

      {/* Action checkboxes */}
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(actions) as Array<keyof typeof actions>).map((key) => {
          const labels: Record<keyof typeof actions, string> = {
            closeStaleOpenCashSessions:     "Cerrar cajas abiertas (días anteriores)",
            resolveAutoClosedPendingReview: "Resolver sesiones auto-cerradas pendientes",
            closeStaleOperationalDay:       "Cerrar días operativos anteriores OPEN",
            refreshOperationalDaySummaries: "Refrescar summary del día actual",
          };
          return (
            <label key={key} className="flex items-start gap-2 text-xs text-[var(--color-text)] cursor-pointer">
              <input
                type="checkbox"
                checked={actions[key]}
                onChange={(e) => setActions((a) => ({ ...a, [key]: e.target.checked }))}
                className="mt-0.5"
              />
              <span>{labels[key]}</span>
            </label>
          );
        })}
      </div>

      {/* Diagnosis results */}
      {diagnosis && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2 text-xs">
          <p className="font-semibold text-[var(--color-text-muted)] uppercase tracking-wide text-[0.6875rem]">Diagnóstico (DRY_RUN)</p>
          <div className="space-y-1">
            <p><span className="font-semibold">{diagnosis.staleOpenCashSessions.length}</span> caja(s) abierta(s) en días anteriores</p>
            <p><span className="font-semibold">{diagnosis.autoClosedPendingReviewSessions.length}</span> sesión(es) auto-cerrada(s) pendiente revisión</p>
            <p><span className="font-semibold">{diagnosis.staleOpenOperationalDays.length}</span> día(s) operativo(s) OPEN de fechas anteriores</p>
            {diagnosis.staleOpenCashSessions.length > 0 && (
              <ul className="ml-3 text-[var(--color-text-secondary)] list-disc">
                {diagnosis.staleOpenCashSessions.map((s) => (
                  <li key={s.id}>Caja {s.physicalCashBoxCode} — abierta desde {new Date(s.openedAt).toLocaleString("es-NI")}</li>
                ))}
              </ul>
            )}
          </div>
          {diagnosis.staleOpenCashSessions.length === 0 &&
           diagnosis.autoClosedPendingReviewSessions.length === 0 &&
           diagnosis.staleOpenOperationalDays.length === 0 && (
            <p className="text-[var(--color-success-700)] font-semibold">Sin estados atascados detectados. No se requiere limpieza.</p>
          )}
        </div>
      )}

      {/* Result after execute */}
      {result && step === "done" && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2 text-xs">
          <p className="font-semibold text-[var(--color-text-muted)] uppercase tracking-wide text-[0.6875rem]">Resultado</p>
          {result.actionsTaken.map((a, i) => <p key={i} className="text-[var(--color-success-700)]">✓ {a}</p>)}
          {result.errors.map((e, i) => <p key={i} className="text-[var(--color-danger-700)]">✗ {e}</p>)}
        </div>
      )}

      {/* Note + buttons */}
      {step !== "done" && (
        <div className="space-y-2">
          {step === "diagnosed" && (
            <div className="grid gap-1">
              <label className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                Nota de justificación (requerida para ejecutar)
              </label>
              <textarea
                className="hm-input rounded-lg text-xs w-full"
                rows={2}
                placeholder="Motivo de la limpieza forzada..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}
          <div className="flex gap-2">
            {step === "idle" && (
              <Button variant="secondary" size="sm" onClick={runDryRun} disabled={!anyActionSelected}>
                Diagnosticar (DRY_RUN)
              </Button>
            )}
            {step === "diagnosing" && (
              <Button variant="secondary" size="sm" loading>Diagnosticando...</Button>
            )}
            {step === "diagnosed" && (
              <>
                <Button variant="secondary" size="sm" onClick={runDryRun}>Re-diagnosticar</Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={runExecute}
                  disabled={!note.trim() || !anyActionSelected}
                  className="bg-[var(--color-warning-600)] hover:bg-[var(--color-warning-700)]"
                >
                  Ejecutar limpieza
                </Button>
              </>
            )}
            {step === "executing" && <Button variant="primary" size="sm" loading>Ejecutando...</Button>}
          </div>
        </div>
      )}
    </div>
  );
}

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

  // Force cleanup
  const [cleanupBranchId, setCleanupBranchId] = useState<string | null>(null);
  const cleanupBranch = useMemo(() => branches.find((b) => b.id === cleanupBranchId) ?? null, [branches, cleanupBranchId]);

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

  useEffect(() => {
    void loadLive();
    const t = window.setInterval(() => void loadLive(), 30_000);
    return () => window.clearInterval(t);
  }, [loadLive]);

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

  useEffect(() => {
    void loadPending();
    const t = window.setInterval(() => void loadPending(), 30_000);
    return () => window.clearInterval(t);
  }, [loadPending]);

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

  async function reopenDay(dayId: string, branchCode: string, wasApproved: boolean) {
    const prompt = wasApproved
      ? `Este día ya fue aprobado. Escribe una nota de justificación para reabrir el día de ${branchCode}:`
      : `Escribe una nota para reabrir el día de ${branchCode} (requerido):`;
    const note = window.prompt(prompt);
    if (note === null) return;
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
      await loadPending();
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

      {/* ═══ SECTION 1: Estado Actual ═══════════════════════════════════════ */}
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

        {/* Force Cleanup panel */}
        {cleanupBranchId && cleanupBranch && (
          <ForceCleanupPanel
            branchId={cleanupBranchId}
            branchCode={cleanupBranch.code}
            onClose={() => setCleanupBranchId(null)}
            onDone={async () => { await loadLive(); await loadPending(); }}
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
                          onClick={() => reopenDay(day.id, day.branch.code, !!day.approvedAt)}
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
                  <td colSpan={6} className="py-8 text-center text-sm text-[var(--color-text-muted)]">
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
                      <td className="text-right">{money(day.summaryJson?.expectedCashOnHand ?? 0)}</td>
                      <td className="text-right">
                        {day.status === "CLOSED" && (
                          <Button
                            type="button" variant="ghost" size="sm"
                            loading={reopeningId === day.id}
                            onClick={() => reopenDay(day.id, day.branch.code, true)}
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
                      <td colSpan={6} className="py-8 text-center text-sm text-[var(--color-text-muted)]">
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
