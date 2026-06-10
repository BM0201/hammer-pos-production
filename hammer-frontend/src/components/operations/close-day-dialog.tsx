"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ClosePreview } from "@/components/operations/operational-day-checklist";

export function CloseDayDialog({
  preview,
  disabled,
  onPreview,
  onCloseDay,
}: {
  preview: ClosePreview | null;
  disabled?: boolean;
  onPreview: () => Promise<void>;
  onCloseDay: (note: string, forceClose: boolean) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [forceClose, setForceClose] = useState(false);
  const [busy, setBusy] = useState<"preview" | "close" | null>(null);
  const hasWarnings = Boolean(preview?.warnings.length);
  const hasBlockers = Boolean(preview?.blockers.length);
  const hasHardBlockers = Boolean(preview?.blockers.some((item) => (
    item.key === "open_cash_sessions" || item.key === "auto_closed_pending_review" || item.key === "pending_payments"
  )));
  const canForceClose = hasBlockers && !hasHardBlockers;

  async function previewNow() {
    setBusy("preview");
    try {
      await onPreview();
    } finally {
      setBusy(null);
    }
  }

  async function closeNow() {
    setBusy("close");
    try {
      await onCloseDay(note.trim(), forceClose);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={previewNow} loading={busy === "preview"} disabled={disabled}>Previsualizar cierre</Button>
        <Button variant="danger" onClick={closeNow} loading={busy === "close"} disabled={disabled || !preview || hasHardBlockers || (hasBlockers && !forceClose) || ((hasWarnings || forceClose) && note.trim().length < 5)}>
          Cerrar dia operativo
        </Button>
      </div>
      <label className="mt-3 grid gap-1 text-sm">
        <span className="font-semibold text-[var(--color-text-muted)]">Nota de cierre</span>
        <textarea className="hm-input min-h-20 rounded-lg px-3 py-2" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Obligatoria si hay advertencias o cierre forzado." />
      </label>
      {canForceClose ? (
        <label className="mt-3 flex items-center gap-2 text-sm text-[var(--color-danger-700)]">
          <input type="checkbox" checked={forceClose} onChange={(event) => setForceClose(event.target.checked)} />
          Forzar cierre con permiso MASTER
        </label>
      ) : null}
      {hasHardBlockers ? (
        <p className="mt-3 text-sm text-[var(--color-danger-700)]">
          Hay bloqueantes duros: cajas abiertas, cierres automaticos pendientes o pagos pendientes deben resolverse antes de cerrar.
        </p>
      ) : null}
    </div>
  );
}
