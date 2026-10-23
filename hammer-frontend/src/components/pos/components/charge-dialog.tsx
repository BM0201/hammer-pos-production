"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { PaymentComposer, type ComposedTender, type BankAccountOption } from "@/components/payments/payment-composer";
import { money } from "@/lib/format";
import type { TicketLine } from "../types";

type ChargeDialogProps = {
  open: boolean;
  onClose: () => void;
  total: number;
  branchId: string;
  onConfirm: (tenders: ComposedTender[]) => void;
  isSubmitting: boolean;
  /** prompt-caja-gastos-pos-cobro.md Commit 4 — el pedido, en solo lectura, al lado del pago en computadora. */
  ticketLines?: TicketLine[];
};

/** "2 productos · C$ 490.00" — el pedido plegado en tablet/móvil (doc punto 2). */
function OrderSummaryLine({ lines, total }: { lines: TicketLine[]; total: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex-none lg:hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2 text-xs font-semibold text-[var(--color-text)]"
      >
        <span>{lines.length} producto{lines.length === 1 ? "" : "s"} · {money(total)}</span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {expanded && (
        <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-xs">
          {lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-2 text-[var(--color-text-secondary)]">
              <span className="truncate">{l.product?.name ?? l.productId} ×{l.quantity}</span>
              <span className="shrink-0 tabular-nums">{money(Number(l.lineSubtotal))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** El pedido en solo lectura — columna izquierda en computadora (doc punto 2). */
function OrderReadOnlyPanel({ lines, total, onBack }: { lines: TicketLine[]; total: number; onBack: () => void }) {
  return (
    <div className="hidden min-h-0 flex-col lg:flex">
      <button type="button" onClick={onBack} className="mb-3 flex-none text-left text-xs font-semibold text-[var(--color-info-600)] hover:underline">
        ← Volver a productos
      </button>
      <p className="mb-2 flex-none text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">Pedido</p>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {lines.map((l) => (
          <li key={l.id} className="flex justify-between gap-2 text-sm text-[var(--color-text-secondary)]">
            <span className="truncate">{l.product?.name ?? l.productId} <span className="text-[var(--color-text-soft)]">×{l.quantity}</span></span>
            <span className="shrink-0 tabular-nums font-medium text-[var(--color-text)]">{money(Number(l.lineSubtotal))}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex-none border-t border-[var(--color-border)] pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-[var(--color-text)]">Total</span>
          <span className="text-xl font-bold tabular-nums text-[var(--color-pay)]">{money(total)}</span>
        </div>
      </div>
    </div>
  );
}

export function ChargeDialog({ open, onClose, total, branchId, onConfirm, isSubmitting, ticketLines = [] }: ChargeDialogProps) {
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    apiFetch(`/api/master/treasury/bank-accounts?branchId=${branchId}&forPayments=true`)
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => setBankAccounts(raw ? (unwrapApiData(raw) as BankAccountOption[]) : []))
      .catch(() => setBankAccounts([]));
  }, [open, branchId]);

  // prompt-caja-gastos-pos-cobro.md Commit 4 — teclado en computadora: Enter
  // confirma (si está completo y no se está escribiendo en un campo), Esc
  // cierra, Alt+1..4 cambia de pestaña de método. Nunca intercepta Enter
  // mientras el foco está en un input/select/textarea — ahí el navegador
  // hace lo suyo (typing de números), igual que cualquier formulario.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isFormField = target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Enter" && !isFormField) {
        e.preventDefault();
        const btn = dialogRef.current?.querySelector<HTMLButtonElement>('[data-testid="payment-composer-confirm"]');
        if (btn && !btn.disabled) btn.click();
        return;
      }
      if (e.altKey && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        const tabs = dialogRef.current?.querySelectorAll<HTMLButtonElement>('[data-testid^="payment-composer-tab-"]');
        const idx = Number(e.key) - 1;
        tabs?.[idx]?.click();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-hidden="true" />

      {/* Dialog — angosto en móvil (como antes), dos columnas lado a lado
          desde 1024px (doc punto 2: "computadora: dos columnas, no un
          modal angosto"). max-h-[85vh] deja aire para que el pie del
          composer nunca quede pegado al borde. */}
      <div
        ref={dialogRef}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85vh] max-w-sm flex-col animate-[slideUp_150ms_ease-out] rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-modal)] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl lg:max-w-3xl"
        role="dialog"
        aria-modal="true"
        aria-label="Cobrar"
        data-testid="charge-dialog"
      >
        {/* Header — fijo */}
        <div className="mb-4 flex flex-none items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-[var(--color-text)]">Total a cobrar</h2>
            <p className="text-xl font-bold tabular-nums text-[var(--color-pay)]">{money(total)}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-text-soft)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"
            aria-label="Cerrar (Esc)"
            title="Esc"
          >
            ✕
          </button>
        </div>

        <OrderSummaryLine lines={ticketLines} total={total} />

        {/* key=open fuerza reset del composer cada vez que se abre el diálogo */}
        <div className="mt-3 grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <OrderReadOnlyPanel lines={ticketLines} total={total} onBack={onClose} />
          <div className="min-h-0 flex-1">
            <PaymentComposer key={String(open)} total={total} isSubmitting={isSubmitting} onSubmit={onConfirm} bankAccounts={bankAccounts} />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-testid="charge-dialog"] { animation: none; }
        }
      `}</style>
    </>
  );
}
