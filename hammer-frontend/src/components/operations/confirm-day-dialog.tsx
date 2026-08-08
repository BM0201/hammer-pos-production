"use client";

import { useState, useEffect } from "react";
import { Info, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DayChecklist } from "@/components/operations/operational-day-checklist";

function money(value: string | number | null | undefined) {
  return new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(Number(value ?? 0));
}

type Summary = {
  salesTotal?: number | string | null;
  expectedCashTotal?: number | string | null;
  countedCashTotal?: number | string | null;
  cashDifferenceTotal?: number | string | null;
};

type Props = {
  summary: Summary | null;
  checklist: DayChecklist | null;
  cashDifferenceTolerance?: number;
  onPreview: () => Promise<void>;
  onConfirm: (note: string) => Promise<void>;
};

/**
 * Firma humana — Día Operativo 360. Reemplaza a CloseDayDialog: no hay
 * "forzar cierre" ni bloqueantes duros, porque nada bloquea. Solo exige una
 * nota cuando el checklist tiene ítems en atención — la firma es siempre de
 * un usuario Master real (lo valida el backend, no este componente).
 */
export function ConfirmDayDialog({ summary, checklist, cashDifferenceTolerance = 100, onPreview, onConfirm }: Props) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"preview" | "confirm" | null>(null);

  useEffect(() => {
    if (!checklist) setNote("");
  }, [checklist]);

  const needsNote = Boolean(checklist && checklist.attention.length > 0);
  const noteOk = !needsNote || note.trim().length >= 5;
  const confirmDisabled = !checklist || !noteOk;
  const diff = Number(summary?.cashDifferenceTotal ?? 0);
  const diffOverTolerance = Math.abs(diff) > cashDifferenceTolerance;

  async function previewNow() {
    setBusy("preview");
    try { await onPreview(); } finally { setBusy(null); }
  }

  async function confirmNow() {
    setBusy("confirm");
    try { await onConfirm(note.trim()); } finally { setBusy(null); }
  }

  return (
    <div className="hm-module-card overflow-hidden">
      <div className="hm-module-card-header">
        <h2 className="text-sm font-bold text-[var(--color-text)]">Confirmar día operativo</h2>
      </div>

      <div className="space-y-4 p-4">
        {/* ── 1. Resumen ── */}
        {summary && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
              <p className="text-xs text-[var(--color-text-muted)]">Ventas pagadas</p>
              <p className="hm-num text-base font-bold text-[var(--color-text)]">{money(summary.salesTotal)}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
              <p className="text-xs text-[var(--color-text-muted)]">Efectivo esperado vs contado</p>
              <p className="hm-num text-base font-bold text-[var(--color-text)]">
                {money(summary.expectedCashTotal)} <span className="text-[var(--color-text-soft)]">→</span> {money(summary.countedCashTotal)}
              </p>
            </div>
            <div className="rounded-lg border p-3" style={{ borderColor: diffOverTolerance ? "var(--color-warning-200)" : "var(--color-border)" }}>
              <p className="text-xs text-[var(--color-text-muted)]">Diferencia (tolerancia {money(cashDifferenceTolerance)})</p>
              <p className="hm-num text-base font-bold" style={{ color: diffOverTolerance ? "var(--color-warning-700)" : "var(--color-text)" }}>
                {money(diff)}
              </p>
            </div>
          </div>
        )}

        {/* Trigger para calcular resumen + checklist si aún no se hizo */}
        {!checklist && (
          <Button variant="secondary" size="sm" onClick={previewNow} loading={busy === "preview"}>
            Calcular resumen y checklist
          </Button>
        )}

        {/* ── 3. Firma ── */}
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-1">
            <PenLine style={{ width: "0.75rem", height: "0.75rem" }} />
            Nota de confirmación
            {needsNote && <span className="text-[var(--color-warning-600)] font-bold">*</span>}
          </span>
          <textarea
            className="hm-input min-h-[4.5rem] resize-none rounded-lg px-3 py-2 text-sm"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={needsNote ? "Obligatoria porque hay ítems en atención (mín. 5 caracteres)…" : "Opcional — recomendada para tener contexto en auditoría."}
          />
          {needsNote && note.trim().length > 0 && note.trim().length < 5 && (
            <span className="text-xs text-[var(--color-warning-600)]">Mínimo 5 caracteres ({note.trim().length}/5)</span>
          )}
        </label>

        {!checklist && (
          <div className="flex items-start gap-2.5 rounded-lg border border-[var(--color-info-200)] bg-[color-mix(in_srgb,var(--color-info-50)_30%,white)] px-3.5 py-2.5">
            <Info className="mt-0.5 flex-shrink-0 text-[var(--color-info-600)]" style={{ width: "0.875rem", height: "0.875rem" }} />
            <p className="text-xs leading-relaxed text-[var(--color-info-800)]">Calcula el resumen primero para poder confirmar.</p>
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="primary" onClick={confirmNow} loading={busy === "confirm"} disabled={confirmDisabled} size="sm">
            Confirmar día
          </Button>
        </div>
      </div>
    </div>
  );
}
