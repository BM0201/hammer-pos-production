"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, Banknote, Check, Clock, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, fmtDate } from "@/lib/format";

/**
 * Fase 4 (prompt-cxp.md) — estado de pago de una orden de compra + registrar
 * un pago contra ella. Vive en su propio archivo (convención de la Fase 5
 * de rendimiento de esta misma sesión: paneles pesados en su propio
 * archivo) — el drawer de detalle de purchase-orders/page.tsx ya es grande.
 */

type PurchaseOrderPayable = {
  purchaseOrderId: string;
  debt: number;
  paid: number;
  balance: number;
  dueDate: string | null;
  daysOverdue: number | null;
};

type NioAccount = { id: string; bankName: string; owner: string | null; accountAlias: string; accountNumber: string; currencyCode: string; type: string; isActive: boolean; balance: { balance: number } };

export function PayableStatusPanel({
  purchaseOrderId,
  payable,
  supplierName,
  onPaymentRecorded,
}: {
  purchaseOrderId: string;
  payable: PurchaseOrderPayable | null | undefined;
  supplierName: string;
  onPaymentRecorded: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [accounts, setAccounts] = useState<NioAccount[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!showForm || accounts !== null) return;
    apiFetch("/api/master/treasury/bank-accounts/with-balances")
      .then(async (res) => {
        const raw = await res.json();
        if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudieron cargar las cuentas.");
        const all = unwrapApiData(raw) as NioAccount[];
        // D3 (prompt-cxp.md) — una sola moneda por ahora: solo cuentas de
        // banco en córdobas pueden pagar una orden de compra.
        setAccounts(all.filter((a) => a.type === "BANK" && a.currencyCode === "NIO" && a.isActive));
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "No se pudieron cargar las cuentas."));
  }, [showForm, accounts]);

  if (!payable) return null;

  function openForm() {
    setAmount(payable ? String(payable.balance) : "");
    setShowForm(true);
  }

  async function submitPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!accountId) { toast.error("Selecciona la cuenta de la que sale el pago."); return; }
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) { toast.error("El monto debe ser mayor que 0."); return; }
    if (payable && numeric > payable.balance + 0.001) { toast.error(`El pago no puede superar el saldo pendiente (${money(payable.balance)}).`); return; }

    setSaving(true);
    try {
      const res = await apiFetch("/api/master/treasury/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          amount: numeric,
          entryType: "SUPPLIER_PAYMENT",
          counterpartyType: "SUPPLIER",
          counterpartyName: supplierName || null,
          purchaseOrderId,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo registrar el pago.");
      toast.success("Pago registrado.");
      setShowForm(false);
      setAmount(""); setReference(""); setNotes(""); setAccountId("");
      onPaymentRecorded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar el pago.");
    } finally {
      setSaving(false);
    }
  }

  const isOverdue = (payable.daysOverdue ?? 0) > 0;

  return (
    <section className="mb-6">
      <h4 className="hm-section-rule mb-2.5">Cuentas por pagar</h4>
      <div className={`rounded-lg border p-3 text-[0.8125rem] ${isOverdue ? "border-[var(--color-danger-200)] bg-[var(--color-danger-50)]" : "border-[var(--color-border)] bg-[var(--color-surface-muted)]"}`}>
        <div className="flex items-center justify-between">
          <span className="text-[var(--color-text-secondary)]">Deuda de esta orden</span>
          <span className="hm-num text-[var(--color-text)]">{money(payable.debt)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--color-text-secondary)]">Pagado</span>
          <span className="hm-num text-[var(--color-success-700)]">{money(payable.paid)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-[var(--color-border)] pt-2">
          <span className="font-semibold text-[var(--color-text-secondary)]">Saldo pendiente</span>
          <span className={`hm-num text-[1.0625rem] font-extrabold ${payable.balance > 0.001 ? "text-[var(--color-text)]" : "text-[var(--color-success-700)]"}`}>{money(payable.balance)}</span>
        </div>
        {payable.dueDate && (
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            <Clock className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
            <span className="text-[var(--color-text-secondary)]">Vence {fmtDate(payable.dueDate)}</span>
            {isOverdue && (
              <span className="ml-auto flex items-center gap-1 rounded-full bg-[var(--color-danger-100)] px-2 py-0.5 font-semibold text-[var(--color-danger-700)]">
                <AlertTriangle className="h-3 w-3" /> Vencida hace {payable.daysOverdue} día{payable.daysOverdue !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}
      </div>

      {payable.balance > 0.001 && (
        showForm ? (
          <form onSubmit={submitPayment} className="mt-3 space-y-2.5 rounded-lg border border-[var(--color-border)] p-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Cuenta de origen (córdobas)</label>
              {accounts === null ? (
                <p className="text-xs text-[var(--color-text-muted)]">Cargando cuentas…</p>
              ) : accounts.length === 0 ? (
                <p className="text-xs text-[var(--color-warning-700)]">No hay cuentas activas en córdobas — una compra solo puede pagarse desde una cuenta en NIO por ahora.</p>
              ) : (
                <select className="hm-input w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                  <option value="">Selecciona una cuenta…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.bankName} · {a.owner ?? a.accountAlias} · {a.accountNumber} · {money(a.balance.balance)}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Monto (máx. {money(payable.balance)})</label>
              <Input type="number" step="0.01" min="0.01" max={payable.balance} value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Referencia</label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="No. de comprobante" />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="success" size="sm" loading={saving} icon={<Check className="h-3.5 w-3.5" />}>Registrar pago</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)} disabled={saving}>Cancelar</Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={openForm} icon={<Banknote className="h-3.5 w-3.5" />}>
            Registrar pago
          </Button>
        )
      )}
      {payable.balance <= 0.001 && payable.debt > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[var(--color-success-700)]">
          <DollarSign className="h-3.5 w-3.5" /> Orden saldada por completo.
        </p>
      )}
    </section>
  );
}
