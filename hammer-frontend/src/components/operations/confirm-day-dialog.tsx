"use client";

import { useState, useEffect } from "react";
import { Info, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DayChecklist } from "@/components/operations/operational-day-checklist";
import { money } from "@/lib/format";

type SummarySession = {
  status: string;
  openingAmount: number;
  expectedCashAmount: number;
  countedCashAmount: number;
  cashFundClosedAmount?: number | null;
  expectedUsdAmount?: number | null;
  countedUsdAmount?: number | null;
};

type Summary = {
  salesTotal?: number | string | null;
  expectedCashTotal?: number | string | null;
  countedCashTotal?: number | string | null;
  cashDifferenceTotal?: number | string | null;
  cashSessions?: SummarySession[];
  /** Gastos del día registrados sin salida de gaveta: motivo probable de un faltante. */
  expensesOffDrawer?: { count: number; total: number; items: Array<{ description: string; amount: number }> } | null;
};

/**
 * La diferencia separada en sus dos partes: la venta en efectivo (esperado
 * sin la apertura vs contado sin el sencillo que quedó) y el sencillo
 * (abrió vs quedó). Solo cuando todas las cajas cerradas ya declararon su
 * sencillo; si no, null y se muestra el total como antes.
 */
export function splitCashDifference(sessions: SummarySession[] | undefined) {
  const closed = (sessions ?? []).filter((s) => s.status !== "OPEN" && s.status !== "RECONCILING");
  if (closed.length === 0 || closed.some((s) => s.cashFundClosedAmount == null)) return null;
  const sum = (f: (s: SummarySession) => number) => Math.round(closed.reduce((t, s) => t + f(s), 0) * 100) / 100;
  const usdExpected = sum((s) => s.expectedUsdAmount ?? 0);
  const usdCounted = sum((s) => s.countedUsdAmount ?? 0);
  return {
    salesExpected: sum((s) => s.expectedCashAmount - s.openingAmount),
    salesCounted: sum((s) => s.countedCashAmount - (s.cashFundClosedAmount ?? 0)),
    fundOpened: sum((s) => s.openingAmount),
    fundClosed: sum((s) => s.cashFundClosedAmount ?? 0),
    usd: usdExpected > 0 || usdCounted > 0 ? { expected: usdExpected, counted: usdCounted } : null,
  };
}

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
const signed = (value: number) => (Math.abs(value) < 0.005 ? "igual" : `${value > 0 ? "+" : "−"}${money(Math.abs(value))}`);

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
  const split = splitCashDifference(summary?.cashSessions);
  const diffLabel = diff > 0 ? "Sobrante" : diff < 0 ? "Faltante" : "Cuadró";
  const offDrawer = diff < 0 && summary?.expensesOffDrawer && summary.expensesOffDrawer.total > 0 ? summary.expensesOffDrawer : null;

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
          <div className="space-y-2">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
              <p className="text-xs text-[var(--color-text-muted)]">Ventas pagadas</p>
              <p className="hm-num text-base font-bold text-[var(--color-text)]">{money(summary.salesTotal)}</p>
            </div>
            {split ? (
              <>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
                  <p className="text-xs text-[var(--color-text-muted)]">Venta en efectivo: debía haber → contaron</p>
                  <p className="hm-num text-base font-bold text-[var(--color-text)]">
                    {money(split.salesExpected)} <span className="text-[var(--color-text-soft)]">→</span> {money(split.salesCounted)}
                  </p>
                  <p className="hm-num text-xs text-[var(--color-text-muted)]">{signed(split.salesCounted - split.salesExpected)}</p>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
                  <p className="text-xs text-[var(--color-text-muted)]">Sencillo: abrió con → quedó</p>
                  <p className="hm-num text-base font-bold text-[var(--color-text)]">
                    {money(split.fundOpened)} <span className="text-[var(--color-text-soft)]">→</span> {money(split.fundClosed)}
                  </p>
                  <p className="hm-num text-xs text-[var(--color-text-muted)]">{signed(split.fundClosed - split.fundOpened)}</p>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 xl:col-span-2">
                <p className="text-xs text-[var(--color-text-muted)]">Efectivo esperado vs contado</p>
                <p className="hm-num text-base font-bold text-[var(--color-text)]">
                  {money(summary.expectedCashTotal)} <span className="text-[var(--color-text-soft)]">→</span> {money(summary.countedCashTotal)}
                </p>
              </div>
            )}
            <div className="rounded-lg border p-3" style={{ borderColor: diffOverTolerance ? "var(--color-warning-200)" : "var(--color-border)" }}>
              <p className="text-xs text-[var(--color-text-muted)]">{diffLabel} (tolerancia {money(cashDifferenceTolerance)})</p>
              <p className="hm-num text-base font-bold" style={{ color: diffOverTolerance ? "var(--color-warning-700)" : "var(--color-text)" }}>
                {money(Math.abs(diff))}
              </p>
              {offDrawer && (
                <p className="text-xs font-semibold text-[var(--color-warning-700)]">Motivo probable: gastos ingresados ({money(offDrawer.total)})</p>
              )}
            </div>
          </div>
          {split?.usd && (
            <p className="hm-num text-xs text-[var(--color-text-secondary)]">
              Dólares aparte: debía haber US${split.usd.expected.toFixed(2)} → contaron US${split.usd.counted.toFixed(2)}
            </p>
          )}
          {diff !== 0 && (
            <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {diff > 0
                ? "Sobró dinero al contar: entra como ingreso en Finanzas (Sobrante de caja). Si un cobro en efectivo quedó anotado como tarjeta o transferencia, o el sencillo se contó con los billetes de venta, revísalo con quien cerró."
                : offDrawer
                  ? `Falta dinero, y ese día se ingresaron gastos que no salieron de la caja en el sistema (se registraron sin caja abierta): ${offDrawer.items.map((e) => `${e.description} ${money(e.amount)}`).join(", ")}. Si se pagaron con dinero de la gaveta, explican ${money(Math.min(offDrawer.total, Math.abs(diff)))} del faltante.`
                  : "Falta dinero. Si un cobro con tarjeta o transferencia se anotó como efectivo, corrígelo en Ventas → Pago y la diferencia se recalcula sola."}
            </p>
          )}
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
          <div className="flex items-start gap-2.5 rounded-lg border border-[var(--color-info-200)] bg-[color-mix(in_srgb,var(--color-info-50)_30%,var(--color-surface))] px-3.5 py-2.5">
            <Info className="mt-0.5 flex-shrink-0 text-[var(--color-info-600)]" style={{ width: "0.875rem", height: "0.875rem" }} />
            <p className="text-xs leading-relaxed text-[var(--color-info-700)]">Calcula el resumen primero para poder confirmar.</p>
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
