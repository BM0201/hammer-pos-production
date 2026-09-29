"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, Landmark } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";
import { money, formatBankAccountOption } from "@/lib/format";

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
 * Depósito directo: el acumulado retenido de CIERRES ANTERIORES sale
 * directo a una cuenta bancaria en córdobas, en una sola acción — sin pasar
 * por "enviar a alguien y que Master confirme después" (ConfirmDepositForm,
 * en la misma pantalla). El monto SIEMPRE se revalida contra el tope en el
 * servidor — este formulario solo evita el viaje redondo obvio (tipear un
 * monto que ya se sabe que va a rebotar).
 *
 * prompt-tesoreria-depositos.md Fase 1 (fix Bug 1) — el tope YA NO es
 * pendingDeposit (que incluía la gaveta ABIERTA, cashInDrawerToday): ese
 * efectivo solo puede salir por la sesión de caja (Destino del efectivo),
 * nunca desde acá. directDepositAvailable es lo único que este flujo puede
 * tomar.
 */
export function DirectDepositSheet({
  branchId,
  branchName,
  directDepositAvailable,
  cashInDrawerToday,
  accounts,
  open,
  onClose,
  onDone,
}: {
  branchId: string;
  branchName: string;
  directDepositAvailable: number;
  cashInDrawerToday: number;
  accounts: BankAccountOption[];
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  // prompt-tesoreria-depositos.md Fase 2 (Bug 2) — las cuentas USD se
  // MUESTRAN deshabilitadas, no se ocultan: que la cuenta no aparezca hace
  // parecer que dejó de existir. bankAccounts es la lista completa (para
  // renderizar todas las opciones); nioAccounts es la única elegible de
  // verdad — la usan el estado vacío y el prefill.
  const bankAccounts = accounts.filter((a) => a.type === "BANK" && a.isActive);
  const nioAccounts = bankAccounts.filter((a) => a.currencyCode === "NIO");

  const [amount, setAmount] = useState(directDepositAvailable.toFixed(2));
  const [bankAccountId, setBankAccountId] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const firstInputFieldRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount(directDepositAvailable.toFixed(2));
    // El prefill nunca puede quedar apuntando a una cuenta deshabilitada (USD).
    setBankAccountId((prev) => (prev && nioAccounts.some((a) => a.id === prev) ? prev : nioAccounts[0]?.id ?? ""));
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
  const overCap = amountNumber > directDepositAvailable + 0.01;
  const nothingAvailable = directDepositAvailable <= 0.01;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return; // el doble click no puede generar dos depósitos — este endpoint mueve dinero real.
    if (!bankAccountId) { toast.error("Selecciona la cuenta destino."); return; }
    if (amountNumber <= 0) { toast.error("El monto debe ser mayor que 0."); return; }
    if (overCap) { toast.error(`El monto no puede superar lo disponible para depositar (${money(directDepositAvailable)}).`); return; }

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
      const account = nioAccounts.find((a) => a.id === bankAccountId);
      toast.success(`Depósito de ${money(amountNumber)} registrado en ${account?.bankName ?? "la cuenta"}.`);
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

        {nioAccounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4 text-center text-sm">
            <Landmark className="mx-auto mb-2 h-5 w-5 text-[var(--color-text-soft)]" aria-hidden="true" />
            <p className="text-[var(--color-text-muted)]">No hay cuentas en córdobas activas.</p>
            <Link href="/app/master/treasury" className="mt-2 inline-block text-xs font-semibold text-[var(--color-pay)] hover:underline">
              Ir a Cuentas bancarias
            </Link>
          </div>
        ) : nothingAvailable ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4 text-center text-sm">
            <Landmark className="mx-auto mb-2 h-5 w-5 text-[var(--color-text-soft)]" aria-hidden="true" />
            <p className="text-[var(--color-text-muted)]">Nada disponible para depositar todavía — no hay efectivo retenido de cierres anteriores.</p>
            {cashInDrawerToday > 0 && (
              <p className="mt-1 text-[0.6875rem] text-[var(--color-text-soft)]">
                La caja abierta tiene {money(cashInDrawerToday)}. Ese efectivo se envía desde Destino del efectivo, no desde acá.
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="flex-none space-y-3">
            {cashInDrawerToday > 0 && (
              <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2 text-[0.6875rem] text-[var(--color-text-muted)]">
                La caja abierta tiene {money(cashInDrawerToday)}. Ese efectivo se envía desde Destino del efectivo, no desde acá.
              </p>
            )}
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
                <Button type="button" variant="secondary" size="sm" onClick={() => setAmount(directDepositAvailable.toFixed(2))}>Todo</Button>
              </div>
              <p className={["mt-1 text-[0.6875rem]", overCap ? "font-semibold text-[var(--color-danger-600)]" : "text-[var(--color-text-soft)]"].join(" ")}>
                Máximo disponible: {money(directDepositAvailable)}
              </p>
            </label>

            <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
              Cuenta destino
              <select className="hm-input mt-1 w-full" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} required>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id} disabled={a.currencyCode !== "NIO"}>
                    {formatBankAccountOption({ ...a, accountAlias: a.owner ?? a.accountAlias })}{a.currencyCode !== "NIO" ? " — no admite efectivo en córdobas" : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[0.6875rem] text-[var(--color-text-soft)]">Se acreditará en C$ (córdobas).</p>
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
              Depositar {amountNumber > 0 ? money(amountNumber) : ""}
            </Button>
          </form>
        )}
      </div>
    </>
  );
}
