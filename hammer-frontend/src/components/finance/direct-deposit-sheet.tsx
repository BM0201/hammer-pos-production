"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, Landmark } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";

const fmt = (v: number) => `C$${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type BankAccountOption = {
  id: string;
  type: string;
  bankName: string;
  accountAlias: string;
  accountNumber: string;
  currencyCode: string;
  isActive: boolean;
  owner: string | null;
};

/**
 * Depósito directo: el acumulado retenido de la sucursal sale directo a una
 * cuenta bancaria en córdobas, en una sola acción — sin pasar por "enviar a
 * alguien y que Master confirme después" (ConfirmDepositForm, en la misma
 * pantalla). El monto SIEMPRE se revalida contra el tope en el servidor —
 * este formulario solo evita el viaje redondo obvio (tipear un monto que ya
 * se sabe que va a rebotar).
 */
export function DirectDepositSheet({
  branchId,
  branchName,
  pendingDeposit,
  accounts,
  open,
  onClose,
  onDone,
}: {
  branchId: string;
  branchName: string;
  pendingDeposit: number;
  accounts: BankAccountOption[];
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const eligibleAccounts = accounts.filter((a) => a.type === "BANK" && a.isActive && a.currencyCode === "NIO");

  const [amount, setAmount] = useState(pendingDeposit.toFixed(2));
  const [bankAccountId, setBankAccountId] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const firstInputFieldRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount(pendingDeposit.toFixed(2));
    setBankAccountId((prev) => (prev && eligibleAccounts.some((a) => a.id === prev) ? prev : eligibleAccounts[0]?.id ?? ""));
    setReferenceNumber("");
    setNotes("");
    returnFocusRef.current = document.activeElement;
    setTimeout(() => firstInputFieldRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branchId]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleClose() {
    onClose();
    setTimeout(() => {
      if (returnFocusRef.current instanceof HTMLElement) returnFocusRef.current.focus();
    }, 50);
  }

  if (!open) return null;

  const amountNumber = Number(amount) || 0;
  const overCap = amountNumber > pendingDeposit + 0.01;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return; // el doble click no puede generar dos depósitos — este endpoint mueve dinero real.
    if (!bankAccountId) { toast.error("Selecciona la cuenta destino."); return; }
    if (amountNumber <= 0) { toast.error("El monto debe ser mayor que 0."); return; }
    if (overCap) { toast.error(`El monto no puede superar lo disponible para depositar (${fmt(pendingDeposit)}).`); return; }

    setSubmitting(true);
    try {
      const res = await apiFetch("/api/master/treasury/branch-deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          bankAccountId,
          amount: amountNumber,
          referenceNumber: referenceNumber.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo registrar el depósito.");
      const account = eligibleAccounts.find((a) => a.id === bankAccountId);
      toast.success(`Depósito de ${fmt(amountNumber)} registrado en ${account?.bankName ?? "la cuenta"}.`);
      onDone();
      handleClose();
    } catch (error) {
      // Error → el sheet queda ABIERTO con los datos intactos, nunca se cierra con un fallo.
      toast.error(error instanceof Error ? error.message : "No se pudo registrar el depósito.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={submitting ? undefined : handleClose} aria-hidden="true" />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Depositar a cuenta"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90vh] max-w-lg flex-col gap-3 overflow-y-auto rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
      >
        <div className="flex flex-none items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Depositar a cuenta</h3>
            <p className="text-xs text-[var(--color-text-muted)]">{branchName}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={handleClose} disabled={submitting} icon={<X className="h-4 w-4" />}>Cerrar</Button>
        </div>

        {eligibleAccounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4 text-center text-sm">
            <Landmark className="mx-auto mb-2 h-5 w-5 text-[var(--color-text-soft)]" aria-hidden="true" />
            <p className="text-[var(--color-text-muted)]">No hay cuentas en córdobas activas.</p>
            <Link href="/app/master/treasury" className="mt-2 inline-block text-xs font-semibold text-[var(--color-pay)] hover:underline">
              Ir a Cuentas bancarias
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="flex-none space-y-3">
            <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
              Monto
              <div className="mt-1 flex items-center gap-2">
                <Input
                  ref={firstInputFieldRef}
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={overCap ? "border-[var(--color-danger-400)]" : ""}
                  required
                />
                <Button type="button" variant="secondary" size="sm" onClick={() => setAmount(pendingDeposit.toFixed(2))}>Todo</Button>
              </div>
              <p className={["mt-1 text-[0.6875rem]", overCap ? "font-semibold text-[var(--color-danger-600)]" : "text-[var(--color-text-soft)]"].join(" ")}>
                Máximo disponible: {fmt(pendingDeposit)}
              </p>
            </label>

            <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
              Cuenta destino
              <select className="hm-input mt-1 w-full" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} required>
                {eligibleAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.bankName} · {a.owner ?? a.accountAlias} · {a.accountNumber}</option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
              Referencia (opcional)
              <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="No. de minuta o boleta" className="mt-1" />
            </label>

            <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
              Notas (opcional)
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
            </label>

            <Button type="submit" variant="success" loading={submitting} disabled={overCap} className="w-full">
              Depositar {amountNumber > 0 ? fmt(amountNumber) : ""}
            </Button>
          </form>
        )}
      </div>
    </>
  );
}
