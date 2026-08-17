"use client";

import { useEffect, useState } from "react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { PaymentComposer, type ComposedTender, type BankAccountOption } from "@/components/payments/payment-composer";

type ChargeDialogProps = {
  open: boolean;
  onClose: () => void;
  total: number;
  branchId: string;
  onConfirm: (tenders: ComposedTender[]) => void;
  isSubmitting: boolean;
};

export function ChargeDialog({ open, onClose, total, branchId, onConfirm, isSubmitting }: ChargeDialogProps) {
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);

  useEffect(() => {
    if (!open) return;
    apiFetch(`/api/master/treasury/bank-accounts?branchId=${branchId}&forPayments=true`)
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => setBankAccounts(raw ? (unwrapApiData(raw) as BankAccountOption[]) : []))
      .catch(() => setBankAccounts([]));
  }, [open, branchId]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-hidden="true" />

      {/* Dialog */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[92vh] max-w-sm overflow-y-auto animate-[slideUp_150ms_ease-out] rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-modal)] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Cobrar"
        data-testid="charge-dialog"
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-[var(--color-text)]">Total a cobrar</h2>
            <p className="text-xl font-bold tabular-nums text-[var(--color-pay)]">C$ {total.toFixed(2)}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-text-soft)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {/* key=open fuerza reset del composer cada vez que se abre el diálogo */}
        <PaymentComposer key={String(open)} total={total} isSubmitting={isSubmitting} onSubmit={onConfirm} bankAccounts={bankAccounts} />
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
