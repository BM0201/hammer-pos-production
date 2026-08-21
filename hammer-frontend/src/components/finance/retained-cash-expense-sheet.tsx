"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, AlertTriangle, Vault, Landmark, CreditCard } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";
import type { CashPosition } from "@/components/navigation/cash-indicator-panel";

const fmt = (v: number) => `C$${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  UTILITIES: "Servicios (Agua, Luz, Internet)",
  RENT: "Renta / Alquiler",
  FOOD: "Alimentación",
  MAINTENANCE: "Mantenimiento",
  TRANSPORT: "Transporte",
  MARKETING: "Mercadeo",
  TAXES: "Impuestos",
  OTHER: "Otro",
};

type BankAccountOption = {
  id: string;
  bankName: string;
  accountAlias: string;
  accountNumber: string;
  owner: string | null;
  cards?: Array<{ id: string; label: string; last4: string | null; cardType: "DEBIT" | "CREDIT" }>;
};

type Source = "RETAINED_CASH" | "BANK" | "CARD";

/**
 * prompt-tesoreria-gasto-retenido-y-techo.md T-5 — el selector de origen es
 * el punto donde se unifican los tres caminos hoy desconectados (efectivo
 * retenido / cuenta bancaria / tarjeta), cada uno enrutando al endpoint que
 * ya le corresponde. Foco atrapado, Escape cierra, el foco vuelve al botón
 * que abrió la hoja.
 */
export function RetainedCashExpenseSheet({
  open,
  onClose,
  branchId,
  position,
  bankAccounts,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  branchId: string;
  position: CashPosition | null;
  bankAccounts: BankAccountOption[];
  onSaved: () => void;
}) {
  const [source, setSource] = useState<Source>("RETAINED_CASH");
  const [category, setCategory] = useState("UTILITIES");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [receiptReference, setReceiptReference] = useState("");
  const [accountId, setAccountId] = useState("");
  const [cardId, setCardId] = useState("");
  const [saving, setSaving] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const firstInputFieldRef = useRef<HTMLInputElement | null>(null);
  const firstSelectFieldRef = useRef<HTMLSelectElement | null>(null);
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement;
    setTimeout(() => (firstInputFieldRef.current ?? firstSelectFieldRef.current)?.focus(), 50);
  }, [open, source]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !containerRef.current) return;
      const focusable = containerRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  function handleClose() {
    onClose();
    setTimeout(() => {
      if (returnFocusRef.current instanceof HTMLElement) returnFocusRef.current.focus();
    }, 50);
  }

  const amountNumber = Number(amount) || 0;
  const account = bankAccounts.find((a) => a.id === accountId) ?? null;

  const preview = useMemo(() => {
    if (source !== "RETAINED_CASH" || !position || amountNumber <= 0) return null;
    const newAccumulated = Math.max(0, position.accumulatedAmount - amountNumber);
    const stillOverdue = position.state === "OVERDUE" || position.state === "CRITICAL";
    return { newAccumulated, stillOverdue };
  }, [source, position, amountNumber]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (amountNumber <= 0) { toast.error("El monto debe ser mayor que 0."); return; }
    setSaving(true);
    try {
      if (source === "RETAINED_CASH") {
        if (!description.trim()) { toast.error("Descripción obligatoria."); setSaving(false); return; }
        if (!receiptReference.trim()) { toast.error("Se requiere una referencia de comprobante (factura/recibo)."); setSaving(false); return; }
        const res = await apiFetch("/api/master/treasury/retained-cash-expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branchId, category, description: description.trim(), amount: amountNumber, receiptReference: receiptReference.trim() }),
        });
        const raw = await res.json().catch(() => null);
        if (res.status === 202) {
          toast.success("Monto sobre el tope — se envió a aprobación. No se movió dinero todavía.");
          resetAndClose();
          return;
        }
        if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo registrar el gasto.");
        toast.success("Gasto registrado. El efectivo retenido bajó.");
        resetAndClose();
      } else {
        if (!accountId) { toast.error("Selecciona la cuenta de origen."); setSaving(false); return; }
        const res = await apiFetch("/api/master/treasury/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId,
            amount: amountNumber,
            entryType: "EXPENSE",
            counterpartyType: "SUPPLIER",
            counterpartyName: description.trim() || null,
            cardId: source === "CARD" ? cardId || null : null,
            reference: receiptReference.trim() || null,
          }),
        });
        const raw = await res.json().catch(() => null);
        if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo registrar el pago.");
        toast.success("Pago registrado.");
        resetAndClose();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar.");
    } finally {
      setSaving(false);
    }
  }

  function resetAndClose() {
    setDescription(""); setAmount(""); setReceiptReference(""); setAccountId(""); setCardId("");
    onSaved();
    handleClose();
  }

  if (!open) return null;

  const overCapLikely = position?.policy && amountNumber > 0; // el tope real (maxCashExpenseAmount) no viaja en CashPosition — el backend decide; acá solo se avisa que puede pasar a aprobación.

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={handleClose} aria-hidden="true" />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Registrar gasto"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90vh] max-w-lg flex-col gap-3 overflow-y-auto rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
      >
        <div className="flex flex-none items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Registrar gasto</h3>
          <Button type="button" variant="ghost" size="sm" onClick={handleClose} icon={<X className="h-4 w-4" />}>Cerrar</Button>
        </div>

        <div className="flex flex-none gap-1.5 rounded-lg border border-[var(--color-border)] p-1">
          <SourceTab icon={Vault} label="Efectivo retenido" active={source === "RETAINED_CASH"} onClick={() => setSource("RETAINED_CASH")} />
          <SourceTab icon={Landmark} label="Cuenta bancaria" active={source === "BANK"} onClick={() => setSource("BANK")} />
          <SourceTab icon={CreditCard} label="Tarjeta" active={source === "CARD"} onClick={() => setSource("CARD")} />
        </div>

        <form onSubmit={submit} className="flex-none space-y-3">
          {source === "RETAINED_CASH" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
                  Categoría
                  <select className="hm-input mt-1 w-full" value={category} onChange={(e) => setCategory(e.target.value)}>
                    {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
                  Monto
                  <Input ref={firstInputFieldRef} type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1" required />
                </label>
              </div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
                Descripción
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Recibo de luz de agosto" className="mt-1" required />
              </label>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
                Referencia del comprobante (obligatoria)
                <Input value={receiptReference} onChange={(e) => setReceiptReference(e.target.value)} placeholder="No. de factura o recibo" className="mt-1" required />
              </label>
            </>
          ) : (
            <>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
                Cuenta de origen
                <select ref={firstSelectFieldRef} className="hm-input mt-1 w-full" value={accountId} onChange={(e) => { setAccountId(e.target.value); setCardId(""); }} required>
                  <option value="">Selecciona una cuenta…</option>
                  {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.bankName} · {a.owner ?? a.accountAlias} · {a.accountNumber}</option>)}
                </select>
              </label>
              {source === "CARD" && account && (
                <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
                  Tarjeta
                  <select className="hm-input mt-1 w-full" value={cardId} onChange={(e) => setCardId(e.target.value)}>
                    <option value="">Sin tarjeta específica</option>
                    {(account.cards ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}{c.last4 ? ` ··${c.last4}` : ""}</option>)}
                  </select>
                </label>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
                  Monto
                  <Input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1" required />
                </label>
                <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
                  Beneficiario
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" />
                </label>
              </div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
                Referencia
                <Input value={receiptReference} onChange={(e) => setReceiptReference(e.target.value)} className="mt-1" />
              </label>
            </>
          )}

          {preview && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-xs">
              <p className="text-[var(--color-text-muted)]">
                Acumulado tras este gasto: <span className="font-semibold tabular-nums text-[var(--color-text)]">{fmt(preview.newAccumulated)}</span>
              </p>
              {preview.stillOverdue && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[var(--color-warning-700)]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Este gasto baja el monto, pero <strong>no</strong> cuenta como depósito — si hay días sin depositar, siguen contando igual después de este gasto.</span>
                </p>
              )}
            </div>
          )}

          {overCapLikely && (
            <p className="text-[0.6875rem] text-[var(--color-text-soft)]">Si el monto supera el tope configurado para esta sucursal, el botón de abajo enviará esto a aprobación en vez de moverlo directo.</p>
          )}

          <Button type="submit" variant="primary" loading={saving} className="w-full">
            {source === "RETAINED_CASH" && overCapLikely ? "Solicitar aprobación / Registrar" : "Registrar"}
          </Button>
        </form>
      </div>
    </>
  );
}

function SourceTab({ icon: Icon, label, active, onClick }: { icon: typeof Vault; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium",
        active ? "bg-[var(--color-pay)] text-white" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]",
      ].join(" ")}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}
