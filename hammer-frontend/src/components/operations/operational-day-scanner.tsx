"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, Wrench, Zap,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { showToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ── Types (mirror force-cleanup-service response) ───────────────────────────────

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

type ActionKey =
  | "closeStaleOpenCashSessions"
  | "resolveAutoClosedPendingReview"
  | "closeStaleOperationalDay"
  | "refreshOperationalDaySummaries";

// ── Helpers ─────────────────────────────────────────────────────────────────────

const money = (v: number | null | undefined) =>
  new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(Number(v ?? 0));

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-NI") : "—";

type Finding = {
  key: ActionKey;
  count: number;
  title: string;
  explanation: string;
  recommendation: string;
  severity: "danger" | "warning";
  details: string[];
};

function buildFindings(d: ForceCleanupDiagnosis): Finding[] {
  const findings: Finding[] = [];

  if (d.autoClosedPendingReviewSessions.length > 0) {
    findings.push({
      key: "resolveAutoClosedPendingReview",
      count: d.autoClosedPendingReviewSessions.length,
      severity: "warning",
      title: "Cierres de caja pendientes de revisión",
      explanation:
        "Una o más cajas fueron auto-cerradas y siguen marcadas como “Pendiente de revisión”. " +
        "Mientras estén así, el día no se puede aprobar y aparecen como bloqueo.",
      recommendation:
        "Forzar la resolución acepta el efectivo esperado como contado y finaliza la sesión (estado AUTO_CLOSED).",
      details: d.autoClosedPendingReviewSessions.map(
        (s) => `Caja ${s.physicalCashBoxCode} · auto-cerrada ${fmtDate(s.autoClosedAt)} · esperado ${money(s.expectedCashAmount)}`,
      ),
    });
  }

  if (d.staleOpenCashSessions.length > 0) {
    findings.push({
      key: "closeStaleOpenCashSessions",
      count: d.staleOpenCashSessions.length,
      severity: "danger",
      title: "Cajas abiertas de días anteriores (atascadas)",
      explanation:
        "Hay cajas que quedaron abiertas en un día operativo anterior. Esto impide abrir o cerrar el día correctamente.",
      recommendation:
        "Forzar el cierre las pasa a revisión (AUTO_CLOSED_PENDING_REVIEW) para que puedan resolverse.",
      details: d.staleOpenCashSessions.map(
        (s) => `Caja ${s.physicalCashBoxCode} · abierta desde ${fmtDate(s.openedAt)}`,
      ),
    });
  }

  if (d.staleOpenOperationalDays.length > 0) {
    findings.push({
      key: "closeStaleOperationalDay",
      count: d.staleOpenOperationalDays.length,
      severity: "danger",
      title: "Días operativos anteriores sin cerrar",
      explanation:
        "Existen días operativos de fechas anteriores que siguen en estado OPEN. Deben cerrarse para liberar la operación.",
      recommendation:
        "Forzar el cierre del día anterior. Requiere que sus cajas ya estén cerradas o en revisión.",
      details: d.staleOpenOperationalDays.map(
        (day) => `Día ${new Date(day.businessDate).toLocaleDateString("es-NI", { timeZone: "UTC" })} · estado ${day.status}`,
      ),
    });
  }

  return findings;
}

// ── Component ────────────────────────────────────────────────────────────────────

export function OperationalDayScanner({
  branchId,
  branchCode,
  onResolved,
  onClose,
  autoScan = true,
}: {
  branchId: string;
  branchCode?: string;
  /** Called after a successful EXECUTE so the parent can reload the day. */
  onResolved?: () => void | Promise<void>;
  /** Optional close/cancel handler — renders a "Cerrar" control when provided. */
  onClose?: () => void;
  /** Run a diagnosis automatically on mount (default: true). */
  autoScan?: boolean;
}) {
  const [step, setStep] = useState<"idle" | "scanning" | "scanned" | "executing" | "done">("idle");
  const [diagnosis, setDiagnosis] = useState<ForceCleanupDiagnosis | null>(null);
  const [result, setResult] = useState<ForceCleanupResult | null>(null);
  const [note, setNote] = useState("");
  const [actions, setActions] = useState<Record<ActionKey, boolean>>({
    closeStaleOpenCashSessions: true,
    resolveAutoClosedPendingReview: true,
    closeStaleOperationalDay: true,
    refreshOperationalDaySummaries: true,
  });

  const runScan = useCallback(async () => {
    setStep("scanning");
    setResult(null);
    try {
      const resp = await apiFetch("/api/master/operations/force-cleanup", {
        method: "POST",
        body: JSON.stringify({ branchId, mode: "DRY_RUN", note: "", actions }),
      });
      const raw = await resp.json();
      if (!resp.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo ejecutar el escáner.");
        setStep("idle");
        return;
      }
      const data = unwrapApiData(raw) as ForceCleanupResult;
      setDiagnosis(data.diagnosis);
      setStep("scanned");
    } catch {
      showToast("error", "Error de red durante el escaneo.");
      setStep("idle");
    }
    // `actions` only toggles which fixes execute; the DRY_RUN diagnosis is the same
    // regardless, so we intentionally do not re-scan when checkboxes change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => {
    if (autoScan) void runScan();
  }, [autoScan, runScan]);

  async function runExecute() {
    if (!note.trim()) {
      showToast("warning", "Escribe una nota de justificación para forzar el cierre.");
      return;
    }
    setStep("executing");
    try {
      const resp = await apiFetch("/api/master/operations/force-cleanup", {
        method: "POST",
        body: JSON.stringify({ branchId, mode: "EXECUTE", note: note.trim(), actions }),
      });
      const raw = await resp.json();
      if (!resp.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo forzar el cierre.");
        setStep("scanned");
        return;
      }
      const data = unwrapApiData(raw) as ForceCleanupResult;
      setResult(data);
      setDiagnosis(data.diagnosis);
      setStep("done");
      if (data.errors.length === 0) {
        showToast("success", "Cierre forzado y actualizado correctamente.");
      } else {
        showToast("warning", `Completado con ${data.errors.length} error(es). Revisa los detalles.`);
      }
      await onResolved?.();
    } catch {
      showToast("error", "Error de red al forzar el cierre.");
      setStep("scanned");
    }
  }

  const findings = diagnosis ? buildFindings(diagnosis) : [];
  const hasProblems = findings.length > 0;
  const anyActionSelected = Object.values(actions).some(Boolean);
  const scanning = step === "scanning";
  const executing = step === "executing";

  const actionLabels: Record<ActionKey, string> = {
    closeStaleOpenCashSessions: "Cerrar cajas abiertas (días anteriores)",
    resolveAutoClosedPendingReview: "Resolver cierres pendientes de revisión",
    closeStaleOperationalDay: "Cerrar días operativos anteriores OPEN",
    refreshOperationalDaySummaries: "Refrescar resumen del día actual",
  };

  return (
    <Card className="space-y-4 border-[var(--color-info-300)] p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <Activity className="text-[var(--color-info-700)]" style={{ width: "1rem", height: "1rem" }} />
        <span className="text-sm font-bold text-[var(--color-text)]">
          Escáner del día operativo{branchCode ? ` — ${branchCode}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={runScan}
            loading={scanning}
            icon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            {step === "idle" ? "Escanear" : "Re-escanear"}
          </Button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Cerrar
            </button>
          )}
        </div>
      </div>

      {/* Scanning state */}
      {scanning && !diagnosis && (
        <p className="text-xs text-[var(--color-text-muted)]">Analizando el estado de cajas y días operativos…</p>
      )}

      {/* Result summary */}
      {diagnosis && !hasProblems && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-success-300)] bg-[color-mix(in_srgb,var(--color-success-50)_50%,white)] px-3 py-2.5">
          <ShieldCheck className="text-[var(--color-success-700)]" style={{ width: "1.1rem", height: "1.1rem" }} />
          <div>
            <p className="text-sm font-semibold text-[var(--color-success-800)]">Sin problemas detectados</p>
            <p className="text-xs text-[var(--color-success-700)]">
              No hay cajas atascadas ni cierres pendientes. El día puede cerrarse/aprobarse normalmente.
            </p>
          </div>
        </div>
      )}

      {/* Findings */}
      {hasProblems && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-[var(--color-warning-700)]" style={{ width: "0.95rem", height: "0.95rem" }} />
            <p className="text-sm font-semibold text-[var(--color-text)]">
              Se {findings.length === 1 ? "detectó 1 problema" : `detectaron ${findings.length} problemas`} que impiden cerrar/aprobar el día
            </p>
          </div>

          {findings.map((f) => (
            <div
              key={f.key}
              className={`rounded-lg border p-3 ${
                f.severity === "danger"
                  ? "border-[var(--color-danger-300)] bg-[color-mix(in_srgb,var(--color-danger-50)_35%,white)]"
                  : "border-[var(--color-warning-300)] bg-[color-mix(in_srgb,var(--color-warning-50)_35%,white)]"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-[var(--color-text)]">{f.title}</span>
                <Badge variant={f.severity === "danger" ? "danger" : "warning"}>{f.count}</Badge>
              </div>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{f.explanation}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                <span className="font-semibold">Acción al forzar:</span> {f.recommendation}
              </p>
              {f.details.length > 0 && (
                <ul className="mt-2 ml-4 list-disc space-y-0.5 text-[0.6875rem] text-[var(--color-text-secondary)]">
                  {f.details.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Execution result */}
      {result && step === "done" && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-1 text-xs">
          <p className="font-semibold uppercase tracking-wide text-[0.6875rem] text-[var(--color-text-muted)]">Resultado</p>
          {result.actionsTaken.length === 0 && result.errors.length === 0 && (
            <p className="text-[var(--color-text-muted)]">No se realizaron cambios.</p>
          )}
          {result.actionsTaken.map((a, i) => (
            <p key={i} className="flex items-start gap-1 text-[var(--color-success-700)]">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" /> {a}
            </p>
          ))}
          {result.errors.map((e, i) => (
            <p key={i} className="flex items-start gap-1 text-[var(--color-danger-700)]">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {e}
            </p>
          ))}
        </div>
      )}

      {/* Fix controls — shown when there are problems and we are not finished */}
      {hasProblems && step !== "done" && (
        <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
          <div className="flex items-center gap-1.5">
            <Wrench className="text-[var(--color-text-muted)]" style={{ width: "0.8rem", height: "0.8rem" }} />
            <span className="text-[0.6875rem] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              Forzar y actualizar el cierre
            </span>
          </div>

          {/* Action toggles */}
          <div className="grid gap-1.5 sm:grid-cols-2">
            {(Object.keys(actions) as ActionKey[]).map((key) => (
              <label key={key} className="flex items-start gap-2 text-xs text-[var(--color-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={actions[key]}
                  onChange={(e) => setActions((a) => ({ ...a, [key]: e.target.checked }))}
                  className="mt-0.5"
                />
                <span>{actionLabels[key]}</span>
              </label>
            ))}
          </div>

          {/* Note */}
          <div className="grid gap-1">
            <label className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Nota de justificación (requerida)
            </label>
            <textarea
              className="hm-input w-full rounded-lg text-xs"
              rows={2}
              placeholder="Motivo del cierre forzado…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={executing}
            onClick={runExecute}
            disabled={!note.trim() || !anyActionSelected}
            icon={<Zap className="h-3.5 w-3.5" />}
            className="bg-[var(--color-warning-600)] hover:bg-[var(--color-warning-700)]"
          >
            Forzar y actualizar cierre
          </Button>
        </div>
      )}

      {/* After done: allow another scan to confirm clean state */}
      {step === "done" && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={runScan}
          icon={<RefreshCw className="h-3.5 w-3.5" />}
        >
          Volver a escanear
        </Button>
      )}
    </Card>
  );
}
