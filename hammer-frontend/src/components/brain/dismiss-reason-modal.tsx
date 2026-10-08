"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * prompt-brain-centro-decisiones.md Fase 3.4 — "'No aplica' pide el motivo
 * en un modal propio, no con prompt()". Motivo obligatorio (mínimo 3
 * caracteres, igual que el backend lo exige).
 */
export function DismissReasonModal({ count, onConfirm, onCancel, submitting }: { count: number; onConfirm: (note: string) => void; onCancel: () => void; submitting: boolean }) {
  const [note, setNote] = useState("");
  const tooShort = note.trim().length < 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          Marcar &quot;No aplica&quot; {count > 1 ? `(${count} decisiones)` : ""}
        </h3>
        <div>
          <label htmlFor="dismiss-reason" className="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]">Motivo (obligatorio)</label>
          <textarea
            id="dismiss-reason"
            className="hm-input"
            rows={3}
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Por qué esta decisión no aplica"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>Cancelar</Button>
          <Button type="button" variant="danger" onClick={() => onConfirm(note.trim())} disabled={tooShort} loading={submitting}>Confirmar</Button>
        </div>
      </div>
    </div>
  );
}
