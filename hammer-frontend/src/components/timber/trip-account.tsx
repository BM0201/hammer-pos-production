"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { showToast } from "@/components/ui/toast";
import { fmtDate, numFixed as fmt } from "@/lib/format";
import { errorCode, errorMessage, timberRequest } from "./trip-api";
import { n } from "./trip-logic";

type Num = number | string;
type Payment = { id: string; kind: string; amount: Num; method: string | null; occurredAt: string; notes: string | null };
type Account = { woodTotal: number; paid: number; deductions: number; balance: number };
type AccountData = { payments: Payment[]; account: Account };

const KINDS = [
  ["ADELANTO", "Adelanto", "Pago antes de recibir la madera"],
  ["ABONO", "Abono", "Pago a cuenta del viaje"],
  ["OTRO_ABONO", "Otro abono", "Saldo de más de otro viaje u otro negocio que cuenta como pago"],
  ["RESTA", "Resta", "Madera mala o faltante que se le descuenta"],
] as const;
const METHODS = [["EFECTIVO", "Efectivo"], ["DEPOSITO", "Depósito"], ["TRANSFERENCIA", "Transferencia"], ["OTRO", "Otro"]] as const;
const kindLabel = (kind: string) => KINDS.find(([k]) => k === kind)?.[1] ?? kind;
const methodLabel = (method: string | null) => METHODS.find(([m]) => m === method)?.[1] ?? method;

const labelClass = "block text-[12px] font-semibold text-[var(--color-text-muted)]";
const inputClass = "mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 min-h-11 text-sm text-[var(--color-text)]";
const todayManagua = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Managua" });

/**
 * Cuenta con el proveedor: madera del viaje − adelantos − abonos − otros abonos − restas = lo que falta.
 * Solo se anota en el viaje; no mueve Tesorería.
 */
export function TripAccount({ tripId, woodTotal, canAdd }: { tripId: string; woodTotal: Num; canAdd: boolean }) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [kind, setKind] = useState<string>("ABONO");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("EFECTIVO");
  const [date, setDate] = useState(todayManagua);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Payment | null>(null);
  const [deleting, setDeleting] = useState(false);

  const apply = (data: AccountData) => { setPayments(data.payments); setAccount(data.account); };
  const load = useCallback(async () => {
    try {
      apply(await timberRequest<AccountData>(`/api/timber/trips/${tripId}/payments`));
    } catch (error) {
      showToast("error", errorMessage(error));
    }
  }, [tripId]);
  // El total de la madera cambia al guardar el borrador o la corrección: recargar el saldo.
  useEffect(() => { void load(); }, [load, woodTotal]);

  async function add() {
    const value = Number(amount);
    if (!(value > 0)) { showToast("warning", "Escribí un monto mayor que cero."); return; }
    setSaving(true);
    try {
      apply(await timberRequest<AccountData>(`/api/timber/trips/${tripId}/payments`, {
        method: "POST",
        // Mediodía en Managua: la fecha no se corre de día al guardarla en UTC.
        body: { kind, amount: value, method: kind === "RESTA" ? null : method, occurredAt: `${date}T12:00:00-06:00`, notes: notes.trim() || null },
      }));
      setAmount("");
      setNotes("");
      showToast("success", `Anotado en el viaje: ${kindLabel(kind).toLowerCase()} de C$ ${fmt(value)}.`);
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      apply(await timberRequest<AccountData>(`/api/timber/trips/${tripId}/payments/${toDelete.id}`, { method: "DELETE" }));
    } catch (error) {
      showToast("error", errorMessage(error));
      if (errorCode(error) === "TIMBER_PAYMENT_NOT_FOUND") await load();
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  }

  const balance = account?.balance ?? n(woodTotal);
  return (
    <Card>
      <div className="hm-section-rule">Cuenta con el proveedor</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-4">
        <Figure label="Madera del viaje" value={account?.woodTotal ?? n(woodTotal)} />
        <Figure label="Pagado" value={account?.paid ?? 0} />
        <Figure label="Restas" value={account?.deductions ?? 0} />
        <div>
          <span className="block text-[var(--color-text-muted)]">{balance < 0 ? "Saldo a favor" : "Falta pagar"}</span>
          <b className={`font-mono text-[15px] ${balance < 0 ? "text-[var(--color-success-700)]" : balance > 0 ? "text-[var(--color-warning-700)]" : ""}`}>C$ {fmt(Math.abs(balance))}</b>
        </div>
      </div>
      <p className="mt-1.5 text-[11.5px] text-[var(--color-text-muted)]">Solo se anota en el viaje: no mueve caja ni Tesorería.</p>

      {payments.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="hm-sheet-table">
            <thead><tr><th>Fecha</th><th>Tipo</th><th className="r">Monto</th><th>Cómo</th><th className="min-w-[10rem]">Nota</th><th><span className="sr-only">Quitar</span></th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap">{fmtDate(p.occurredAt)}</td>
                  <td><b>{kindLabel(p.kind)}</b></td>
                  <td className="hm-num">{p.kind === "RESTA" ? "−" : ""}{fmt(p.amount)}</td>
                  <td>{methodLabel(p.method) ?? "—"}</td>
                  <td className="text-[12px] text-[var(--color-text-muted)]">{p.notes ?? ""}</td>
                  <td>
                    <button type="button" aria-label={`Quitar ${kindLabel(p.kind)} de C$ ${fmt(p.amount)}`} onClick={() => setToDelete(p)} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-danger-50)] hover:text-[var(--color-danger-700)]">
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canAdd && (
        <form className="mt-3 grid gap-2.5 sm:grid-cols-[1fr_1fr_1fr_1fr] [&>*]:min-w-0" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <label className={labelClass}>Tipo
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className={labelClass}>Monto C$
            <input className={inputClass} type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          {kind !== "RESTA" ? (
            <label className={labelClass}>Cómo se pagó
              <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          ) : <span className="hidden sm:block" />}
          <label className={labelClass}>Fecha
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className={`${labelClass} sm:col-span-3`}>Nota
            <input className={inputClass} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder={KINDS.find(([k]) => k === kind)?.[2]} />
          </label>
          <div className="flex items-end">
            <Button type="submit" variant="secondary" className="w-full" loading={saving} icon={<Plus className="h-4 w-4" />}>Anotar</Button>
          </div>
        </form>
      )}

      {toDelete && (
        <ConfirmDialog
          title={`¿Quitar este ${kindLabel(toDelete.kind).toLowerCase()}?`}
          message={`C$ ${fmt(toDelete.amount)} del ${fmtDate(toDelete.occurredAt)}. Sale de la cuenta del viaje y queda en la bitácora.`}
          confirmLabel="Sí, quitar"
          cancelLabel="Dejarlo"
          busy={deleting}
          onConfirm={() => void remove()}
          onCancel={() => setToDelete(null)}
        />
      )}
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span className="block text-[var(--color-text-muted)]">{label}</span>
      <b className="font-mono text-[15px]">C$ {fmt(value)}</b>
    </div>
  );
}
