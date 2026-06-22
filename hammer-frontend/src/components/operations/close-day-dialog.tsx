"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, Lock, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClosePreview } from "@/components/operations/operational-day-checklist";

type Props = {
  preview: ClosePreview | null;
  disabled?: boolean;
  disabledReason?: string;
  onPreview: () => Promise<void>;
  onCloseDay: (note: string, forceClose: boolean) => Promise<void>;
};

export function CloseDayDialog({ preview, disabled, disabledReason, onPreview, onCloseDay }: Props) {
  const [note, setNote] = useState("");
  const [forceClose, setForceClose] = useState(false);
  const [busy, setBusy] = useState<"preview" | "close" | null>(null);

  // Reset form state when preview is cleared (day reloaded after successful close)
  useEffect(() => {
    if (!preview) {
      setNote("");
      setForceClose(false);
    }
  }, [preview]);

  const hasWarnings      = Boolean(preview?.warnings.length);
  const hasBlockers      = Boolean(preview?.blockers.length);
  const hasHardBlockers  = Boolean(preview?.blockers.some((item) =>
    item.key === "open_cash_sessions" || item.key === "auto_closed_pending_review" || item.key === "pending_payments"
  ));
  const canForceClose    = hasBlockers && !hasHardBlockers;
  const needsNote        = hasWarnings || forceClose;
  const noteOk           = !needsNote || note.trim().length >= 5;

  const closeDisabled =
    disabled ||
    !preview ||
    hasHardBlockers ||
    (hasBlockers && !forceClose) ||
    !noteOk;

  function closeReason(): string | null {
    if (disabled && disabledReason) return disabledReason;
    if (disabled) return "No está disponible en el estado actual del día.";
    if (!preview) return "Previsualiza primero para calcular el checklist.";
    if (hasHardBlockers) return "Hay bloqueantes duros que deben resolverse: cajas abiertas, cierres automáticos pendientes o pagos pendientes.";
    if (hasBlockers && !forceClose) return "Hay bloqueantes. Activa «Forzar cierre» si tienes permiso MASTER para continuar.";
    if (!noteOk) return "La nota de cierre debe tener al menos 5 caracteres.";
    return null;
  }

  async function previewNow() {
    setBusy("preview");
    try { await onPreview(); } finally { setBusy(null); }
  }

  async function closeNow() {
    setBusy("close");
    try { await onCloseDay(note.trim(), forceClose); } finally { setBusy(null); }
  }

  const reason = closeReason();

  return (
    <div className="hm-module-card overflow-hidden">
      <div className="hm-module-card-header">
        <h2 className="text-sm font-bold text-[var(--color-text)]">Cierre del día operativo</h2>
      </div>

      <div className="space-y-4 p-4">
        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={previewNow} loading={busy === "preview"} disabled={disabled} size="sm">
            Previsualizar checklist
          </Button>
          <Button
            variant="danger"
            onClick={closeNow}
            loading={busy === "close"}
            disabled={closeDisabled}
            size="sm"
          >
            Cerrar día operativo
          </Button>
        </div>

        {/* Disabled reason */}
        {reason && (
          <div className="flex items-start gap-2.5 rounded-lg border border-[var(--color-info-200)] bg-[color-mix(in_srgb,var(--color-info-50)_30%,white)] px-3.5 py-2.5">
            {hasHardBlockers ? (
              <Lock className="mt-0.5 flex-shrink-0 text-[var(--color-danger-600)]" style={{ width: "0.875rem", height: "0.875rem" }} />
            ) : (
              <Info className="mt-0.5 flex-shrink-0 text-[var(--color-info-600)]" style={{ width: "0.875rem", height: "0.875rem" }} />
            )}
            <p className={`text-xs leading-relaxed ${hasHardBlockers ? "text-[var(--color-danger-800)]" : "text-[var(--color-info-800)]"}`}>
              {reason}
            </p>
          </div>
        )}

        {/* Note */}
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-1">
            Nota de cierre
            {needsNote && <span className="text-[var(--color-danger-600)] font-bold">*</span>}
          </span>
          <textarea
            className="hm-input min-h-[4.5rem] resize-none rounded-lg px-3 py-2 text-sm"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={needsNote ? "Obligatoria con advertencias o cierre forzado (mín. 5 caracteres)…" : "Opcional — recomendada para tener contexto en auditoría."}
          />
          {needsNote && note.trim().length > 0 && note.trim().length < 5 && (
            <span className="text-xs text-[var(--color-danger-600)]">Mínimo 5 caracteres ({note.trim().length}/5)</span>
          )}
        </label>

        {/* Force-close warning section */}
        {canForceClose && (
          <div className="rounded-lg border border-[var(--color-warning-300)] bg-[color-mix(in_srgb,var(--color-warning-50)_40%,white)] p-3.5">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 flex-shrink-0 text-[var(--color-warning-600)]" style={{ width: "0.9375rem", height: "0.9375rem" }} />
              <div className="flex-1">
                <p className="text-xs font-bold text-[var(--color-warning-800)]">Cierre con bloqueantes</p>
                <p className="mt-0.5 text-xs text-[var(--color-warning-700)] leading-relaxed">
                  Hay advertencias que no son bloqueantes duros. Puedes forzar el cierre con autorización MASTER, pero quedará registrado en auditoría.
                </p>
                <label className="mt-3 flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-[var(--color-warning-400)] accent-[var(--color-warning-600)]"
                    checked={forceClose}
                    onChange={(event) => setForceClose(event.target.checked)}
                  />
                  <span className="text-xs font-semibold text-[var(--color-warning-800)]">
                    Forzar cierre con permiso MASTER — entiendo que quedará en bitácora
                  </span>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
