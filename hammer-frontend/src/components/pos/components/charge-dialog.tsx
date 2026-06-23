"use client";

import { useEffect, useState } from "react";
import { Check, CreditCard, ArrowLeftRight, Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";

type PaymentTab = "CASH" | "CARD" | "TRANSFER";

const QUICK_AMOUNTS = [100, 200, 500] as const;

type ChargeDialogProps = {
  open: boolean;
  onClose: () => void;
  total: number;
  paymentMethod: string;
  setPaymentMethod: (m: string) => void;
  referenceNumber: string;
  setReferenceNumber: (r: string) => void;
  onConfirm: () => void;
  isSubmitting: boolean;
};

export function ChargeDialog({
  open,
  onClose,
  total,
  paymentMethod,
  setPaymentMethod,
  referenceNumber,
  setReferenceNumber,
  onConfirm,
  isSubmitting,
}: ChargeDialogProps) {
  const [receivedRaw, setReceivedRaw] = useState("");

  // Sync tab → paymentMethod
  const activeTab = (paymentMethod === "CARD" || paymentMethod === "TRANSFER"
    ? paymentMethod
    : "CASH") as PaymentTab;

  function switchTab(tab: PaymentTab) {
    setPaymentMethod(tab);
    if (tab !== "CASH") setReceivedRaw("");
    if (tab === "CASH") setReferenceNumber("");
  }

  // Reset on open
  useEffect(() => {
    if (open) {
      setReceivedRaw("");
    }
  }, [open]);

  if (!open) return null;

  const received = Number(receivedRaw) || 0;
  const change = received - total;
  const insufficient = activeTab === "CASH" && receivedRaw.length > 0 && received < total;
  const needsRef = (activeTab === "CARD" || activeTab === "TRANSFER") && !referenceNumber.trim();
  const canConfirm = !isSubmitting && !needsRef && !insufficient;

  function appendDigit(digit: string) {
    setReceivedRaw((prev) => {
      if (digit === "00" && !prev) return prev;
      const next = prev + digit;
      // Max 8 digits before decimal
      if (next.replace(".", "").length > 10) return prev;
      return next;
    });
  }

  function backspace() {
    setReceivedRaw((prev) => prev.slice(0, -1));
  }

  function setExact() {
    setReceivedRaw(total.toFixed(2));
  }

  function setQuick(amount: number) {
    setReceivedRaw(String(amount));
  }

  const tabClass = (tab: PaymentTab) =>
    [
      "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors",
      activeTab === tab
        ? "bg-[var(--color-pay)] text-white shadow-sm"
        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]",
    ].join(" ");

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-sm animate-[slideUp_150ms_ease-out] rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-modal)] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Cobrar"
        data-testid="charge-dialog"
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-[var(--color-text)]">Total a cobrar</h2>
            <p className="text-xl font-bold tabular-nums text-[var(--color-pay)]">
              C$ {total.toFixed(2)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-text-soft)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {/* Payment method tabs */}
        <div className="mb-4 flex gap-1 rounded-xl bg-[var(--color-surface-muted)] p-1">
          <button className={tabClass("CASH")} onClick={() => switchTab("CASH")}>
            <Banknote className="h-3.5 w-3.5" />
            Efectivo
          </button>
          <button className={tabClass("CARD")} onClick={() => switchTab("CARD")}>
            <CreditCard className="h-3.5 w-3.5" />
            Tarjeta
          </button>
          <button className={tabClass("TRANSFER")} onClick={() => switchTab("TRANSFER")}>
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Transfer.
          </button>
        </div>

        {/* CASH panel */}
        {activeTab === "CASH" ? (
          <div>
            {/* Received display */}
            <div className="mb-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Recibido
              </p>
              <p className={[
                "mt-0.5 text-2xl font-bold tabular-nums",
                receivedRaw ? "text-[var(--color-text)]" : "text-[var(--color-text-soft)]",
              ].join(" ")}>
                C$ {receivedRaw ? Number(receivedRaw).toFixed(2) : "0.00"}
              </p>
            </div>

            {/* Vuelto / Falta */}
            {receivedRaw.length > 0 ? (
              <div className={[
                "mb-3 rounded-xl px-4 py-2.5 text-center",
                insufficient
                  ? "bg-[var(--color-danger-50)] border border-[var(--color-danger-200)]"
                  : "bg-[var(--color-success-50)] border border-[var(--color-success-200)]",
              ].join(" ")}>
                {insufficient ? (
                  <p className="text-sm font-semibold text-[var(--color-danger-600)]">
                    Falta C$ {(total - received).toFixed(2)}
                  </p>
                ) : (
                  <p className="text-sm font-semibold text-[var(--color-success-700)]">
                    Vuelto C$ {change.toFixed(2)}
                  </p>
                )}
              </div>
            ) : null}

            {/* Quick amounts */}
            <div className="mb-3 grid grid-cols-4 gap-1.5">
              {QUICK_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setQuick(amt)}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:border-[var(--color-pay)] hover:text-[var(--color-pay)] transition-colors"
                >
                  C${amt}
                </button>
              ))}
              <button
                onClick={setExact}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:border-[var(--color-pay)] hover:text-[var(--color-pay)] transition-colors"
              >
                Exacto
              </button>
            </div>

            {/* Numpad */}
            <div className="grid grid-cols-3 gap-1.5">
              {["1","2","3","4","5","6","7","8","9","00","0"].map((d) => (
                <button
                  key={d}
                  onClick={() => appendDigit(d)}
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-3 text-lg font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] active:scale-95 transition-[background-color,transform]"
                >
                  {d}
                </button>
              ))}
              <button
                onClick={backspace}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-3 flex items-center justify-center text-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] active:scale-95 transition-[background-color,transform]"
                aria-label="Borrar"
              >
                ⌫
              </button>
            </div>
          </div>
        ) : null}

        {/* CARD / TRANSFER panel */}
        {(activeTab === "CARD" || activeTab === "TRANSFER") ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                Número de referencia <span className="text-[var(--color-danger-600)]">*</span>
              </label>
              <input
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-soft)] focus:border-[var(--color-pay)] focus:ring-2 focus:ring-[var(--color-pay)]/10"
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder={activeTab === "CARD" ? "Nro. de autorización" : "Nro. de transacción"}
                autoFocus
                data-testid="charge-reference-number"
              />
              {needsRef ? (
                <p className="mt-1 text-xs text-[var(--color-danger-600)]">
                  Requerido para {activeTab === "CARD" ? "tarjeta" : "transferencia"}.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Confirm button */}
        <Button
          variant="success"
          className="mt-4 w-full rounded-xl py-3 text-base font-bold"
          onClick={onConfirm}
          disabled={!canConfirm}
          loading={isSubmitting}
          icon={<Check className="h-5 w-5" />}
          data-testid="charge-confirm"
        >
          Confirmar cobro
        </Button>
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
