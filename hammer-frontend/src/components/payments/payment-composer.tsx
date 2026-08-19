"use client";

import { useMemo, useState } from "react";
import { Banknote, CreditCard, ArrowLeftRight, Plus, X, Check, ChevronRight, ChevronLeft, ChevronDown, Copy, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";

/**
 * Composición de pago compartida entre el diálogo de cobro del POS
 * (charge-dialog.tsx) y la cola de cajero (cashier-payments.tsx) —
 * correccion-destino-y-pantalla-cobro.md §2.3/§2.4,
 * prompt-pantallas-recorrido-dinero.md §1 (Pantalla 1 · Cobro),
 * prompt-correccion-dialogo-cobro.md (sin pestañas: una sola lista de
 * líneas, se agrega una del método que corresponda — nunca "se elige un
 * método" por separado de agregar la línea).
 *
 * Modelo mental: no se elige un método, se arma el pago hasta cubrir el
 * total. El backend ya soporta esto de punta a punta (PaymentTender,
 * normalizeTenders, PaymentMethod.MIXED) — esto es la interfaz que faltaba.
 */

export type TenderMethod = "CASH" | "CARD" | "TRANSFER";

export type BankAccountOption = {
  id: string;
  bankName: string;
  accountAlias: string;
  accountNumber: string;
  currencyCode: string;
  owner: string | null;
};

export type ComposedTender = {
  method: TenderMethod;
  amount: number;
  receivedAmount?: number;
  changeAmount?: number;
  referenceNumber?: string | null;
  bankAccountId?: string | null;
};

type DraftLine = {
  id: string;
  method: TenderMethod;
  amountRaw: string;
  receivedRaw: string;
  referenceNumber: string;
  bankAccountId: string;
  /** Solo gatilla CUÁNDO se muestran los errores (§1.5: "al confirmar o al
   * salir del campo, nunca al abrir") — no participa en si el pago es válido. */
  touched: boolean;
};

const METHOD_META: Record<TenderMethod, { label: string; icon: typeof Banknote }> = {
  CASH: { label: "Efectivo", icon: Banknote },
  CARD: { label: "Tarjeta", icon: CreditCard },
  TRANSFER: { label: "Transferencia", icon: ArrowLeftRight },
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function nextId(existing: DraftLine[]) {
  return String(existing.reduce((max, l) => Math.max(max, Number(l.id) || 0), 0) + 1);
}

function newLine(method: TenderMethod, amount: number, existing: DraftLine[]): DraftLine {
  return {
    id: nextId(existing),
    method,
    amountRaw: amount > 0 ? amount.toFixed(2) : "",
    receivedRaw: "",
    referenceNumber: "",
    bankAccountId: "",
    touched: false,
  };
}

const BILLETES = [50, 100, 200, 500, 1000] as const;
const BILLETE_MAYOR = 1000;

/**
 * Montos con los que realmente te pagan un total dado (prompt-correccion-
 * dialogo-cobro.md §2.4). El exacto primero; después el siguiente múltiplo
 * de 50 (el vuelto chico que se da con monedas y billetes bajos); después
 * las denominaciones de billete que superan el total; si ninguna alcanza
 * (el total supera hasta el billete más grande), se completa con múltiplos
 * del billete mayor. El algoritmo anterior usaba pasos fijos de
 * 500/1000/2000: correcto para C$890, absurdo para C$45, donde ofrecía
 * tres montos que nadie va a entregar por un clavo.
 */
export function quickCashAmounts(total: number): number[] {
  if (!(total > 0)) return [];
  const out: number[] = [round2(total)];

  const nextFifty = Math.ceil(total / 50) * 50;
  if (nextFifty > total && !out.includes(nextFifty)) out.push(nextFifty);

  for (const bill of BILLETES) {
    if (out.length >= 4) break;
    if (bill >= total && !out.includes(bill)) out.push(bill);
  }

  if (out.length < 4) {
    let candidate = Math.ceil(total / BILLETE_MAYOR) * BILLETE_MAYOR;
    if (candidate <= total) candidate += BILLETE_MAYOR;
    while (out.length < 4) {
      if (!out.includes(candidate)) out.push(candidate);
      candidate += BILLETE_MAYOR;
    }
  }

  return out.slice(0, 4);
}

type LineValidation = { amount: number; valid: boolean; needsReference: boolean; needsBankAccount: boolean; insufficientCash: boolean };

/**
 * `accountsAvailable`: si la sucursal todavía no tiene cuentas cargadas, la
 * cuenta de destino no se exige — no se puede pedir un dato que no existe
 * (correccion-destino-y-pantalla-cobro.md §5: "si es una sola cuenta, el
 * selector desaparece"; sin ninguna, tampoco se pide).
 */
function validateLine(line: DraftLine, accountsAvailable: boolean): LineValidation {
  const amount = Number(line.amountRaw) || 0;
  if (line.method === "CASH") {
    const received = line.receivedRaw.length > 0 ? Number(line.receivedRaw) || 0 : amount;
    const insufficientCash = received < amount;
    return { amount, valid: amount > 0 && !insufficientCash, needsReference: false, needsBankAccount: false, insufficientCash };
  }
  const needsReference = !line.referenceNumber.trim();
  const needsBankAccount = line.method === "TRANSFER" && accountsAvailable && !line.bankAccountId;
  return { amount, valid: amount > 0 && !needsReference && !needsBankAccount, needsReference, needsBankAccount, insufficientCash: false };
}

export type PaymentComposerProps = {
  total: number;
  isSubmitting?: boolean;
  submitLabel?: string;
  onSubmit: (tenders: ComposedTender[]) => void;
  /** Métodos ofrecidos para agregar — por defecto los tres. Venta directa puede excluir CREDIT/otros aparte. */
  availableMethods?: TenderMethod[];
  /** Cuentas propias para "¿a qué cuenta entró?" en transferencias (§2.2/§3). Sin cuentas cargadas, no se pide. */
  bankAccounts?: BankAccountOption[];
};

export function PaymentComposer({
  total,
  isSubmitting = false,
  submitLabel = "Confirmar cobro",
  onSubmit,
  availableMethods = ["CASH", "CARD", "TRANSFER"],
  bankAccounts = [],
}: PaymentComposerProps) {
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine("CASH", total, [])]);
  // Acordeón: solo una línea abierta a la vez (§2.2, prueba 12). La línea
  // inicial de efectivo arranca abierta — es el caso simple, un toque.
  const [openLineId, setOpenLineId] = useState<string | null>(() => lines[0]?.id ?? null);
  const [pickerLineId, setPickerLineId] = useState<string | null>(null);
  const accountsAvailable = bankAccounts.length > 0;

  const validations = useMemo(() => lines.map((l) => validateLine(l, accountsAvailable)), [lines, accountsAvailable]);
  const covered = useMemo(() => round2(validations.reduce((sum, v) => sum + v.amount, 0)), [validations]);
  const missing = round2(total - covered);
  const exactMatch = Math.abs(missing) < 0.005;
  const allLinesValid = validations.every((v) => v.valid);
  const canConfirm = !isSubmitting && lines.length > 0 && exactMatch && allLinesValid;
  const hasCashLine = lines.some((l) => l.method === "CASH");

  function updateLine(id: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function touchLine(id: string) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, touched: true } : l)));
  }

  function removeLine(id: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
    setOpenLineId((prev) => (prev === id ? null : prev));
  }

  function addLine(method: TenderMethod) {
    const line = newLine(method, Math.max(missing, 0), lines);
    setLines((prev) => [...prev, line]);
    setOpenLineId(line.id);
    if (method === "TRANSFER" && bankAccounts.length > 0) setPickerLineId(line.id);
  }

  function toggleOpen(id: string) {
    setOpenLineId((prev) => (prev === id ? null : id));
  }

  function confirm() {
    if (!canConfirm) {
      setLines((prev) => prev.map((l) => ({ ...l, touched: true })));
      return;
    }
    const tenders: ComposedTender[] = lines.map((line, i) => {
      const v = validations[i];
      if (line.method === "CASH") {
        const received = line.receivedRaw.length > 0 ? Number(line.receivedRaw) || 0 : v.amount;
        return { method: "CASH", amount: v.amount, receivedAmount: round2(received), changeAmount: round2(received - v.amount) };
      }
      return {
        method: line.method,
        amount: v.amount,
        referenceNumber: line.referenceNumber.trim(),
        bankAccountId: line.method === "TRANSFER" ? line.bankAccountId || null : undefined,
      };
    });
    onSubmit(tenders);
  }

  const pickerLine = pickerLineId ? lines.find((l) => l.id === pickerLineId) ?? null : null;

  if (pickerLine) {
    return (
      <AccountPickerStep
        total={pickerLine.amountRaw ? Number(pickerLine.amountRaw) || 0 : total}
        accounts={bankAccounts}
        selectedId={pickerLine.bankAccountId}
        onPick={(accountId) => updateLine(pickerLine.id, { bankAccountId: accountId })}
        onDone={() => setPickerLineId(null)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Barra de cubierto/falta — siempre visible (§2.3), no solo con 2+ líneas. */}
      <div
        className={[
          "mb-3 flex flex-none items-center justify-between rounded-xl px-4 py-2.5 text-sm font-semibold",
          exactMatch
            ? "border border-[var(--color-success-200)] bg-[var(--color-success-50)] text-[var(--color-success-700)]"
            : "border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] text-[var(--color-danger-600)]",
        ].join(" ")}
      >
        <span>Cubierto C$ {covered.toFixed(2)}</span>
        <span>{exactMatch ? "Completo" : missing > 0 ? `Falta C$ ${missing.toFixed(2)}` : `Sobra C$ ${Math.abs(missing).toFixed(2)}`}</span>
      </div>

      {/* Lista de líneas — única área con scroll (§1/§2.5). */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {lines.map((line, i) => (
          <LineItem
            key={line.id}
            line={line}
            validation={validations[i]}
            total={total}
            open={openLineId === line.id}
            removable={lines.length > 1}
            bankAccounts={bankAccounts}
            onToggleOpen={() => toggleOpen(line.id)}
            onChange={(patch) => updateLine(line.id, patch)}
            onTouch={() => touchLine(line.id)}
            onRemove={() => removeLine(line.id)}
            onOpenAccountPicker={() => setPickerLineId(line.id)}
          />
        ))}
      </div>

      {/* Pie fijo: agregar método + confirmar (§2.5, prueba 11). */}
      <div className="flex-none space-y-2 pt-3">
        <div className="flex flex-wrap gap-1.5">
          {availableMethods
            .filter((method) => method !== "CASH" || !hasCashLine) // §3: efectivo, una sola línea (prueba 5)
            .map((method) => {
              const Meta = METHOD_META[method];
              return (
                <button
                  key={method}
                  type="button"
                  onClick={() => addLine(method)}
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-pay)] hover:text-[var(--color-pay)]"
                >
                  <Plus className="h-3 w-3" /> {Meta.label}
                </button>
              );
            })}
        </div>

        <Button
          variant="success"
          className="w-full rounded-xl py-3 text-base font-bold"
          onClick={confirm}
          disabled={isSubmitting || !exactMatch}
          loading={isSubmitting}
          icon={<Check className="h-5 w-5" />}
          data-testid="payment-composer-confirm"
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/** Texto informativo bajo una línea de tarjeta — nunca invisible: la plata
 * de tarjeta no entra al banco por el monto de la venta, se liquida a 1-2
 * días menos comisión (prompt-pantallas-recorrido-dinero.md §1.4). */
function CardSettlementNote() {
  return (
    <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-[var(--color-warning-50)] px-2.5 py-2 text-[0.6875rem] leading-snug text-[var(--color-warning-700)]">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      Se liquida en 1–2 días, menos comisión. Entra a <b>Por liquidar</b>, no al banco.
    </p>
  );
}

/**
 * Una línea del cobro — encabezado siempre visible (ícono, método, monto
 * editable, quitar) y, si está abierta, el cuerpo propio del método debajo
 * (prompt-correccion-dialogo-cobro.md §2.2). Reemplaza los dos componentes
 * viejos (SingleLineEditor + TenderRow): antes el caso de una sola línea
 * tenía su propio layout con pestañas de método — ahora toda línea se ve
 * igual, se abra o no.
 */
function LineItem({
  line, validation, total, open, removable, bankAccounts, onToggleOpen, onChange, onTouch, onRemove, onOpenAccountPicker,
}: {
  line: DraftLine;
  validation: LineValidation;
  total: number;
  open: boolean;
  removable: boolean;
  bankAccounts: BankAccountOption[];
  onToggleOpen: () => void;
  onChange: (patch: Partial<DraftLine>) => void;
  onTouch: () => void;
  onRemove: () => void;
  onOpenAccountPicker: () => void;
}) {
  const Meta = METHOD_META[line.method];
  const Icon = Meta.icon;
  const received = Number(line.receivedRaw) || 0;
  const change = line.method === "CASH" && line.receivedRaw ? round2(received - validation.amount) : null;
  const selectedAccount = bankAccounts.find((a) => a.id === line.bankAccountId) ?? null;
  const quickAmounts = useMemo(() => quickCashAmounts(validation.amount || total), [validation.amount, total]);

  function appendDigit(digit: string) {
    if (digit === "00" && !line.receivedRaw) return;
    const next = line.receivedRaw + digit;
    if (next.replace(".", "").length > 10) return;
    onChange({ receivedRaw: next });
  }

  return (
    <div className={["rounded-xl border bg-[var(--color-surface)] transition-colors", open ? "border-[var(--color-pay)]" : "border-[var(--color-border)]"].join(" ")}>
      <div className="flex items-center gap-2 p-2.5">
        <button type="button" onClick={onToggleOpen} className="flex flex-1 items-center gap-2 text-left" data-testid={`payment-composer-line-header-${line.method}`}>
          <Icon className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
          <span className="shrink-0 text-sm font-semibold text-[var(--color-text)]">{Meta.label}</span>
          <ChevronDown className={["ml-auto h-3.5 w-3.5 shrink-0 text-[var(--color-text-soft)] transition-transform", open ? "rotate-180" : ""].join(" ")} />
        </button>
        <Input
          type="number"
          min="0.01"
          step="0.01"
          value={line.amountRaw}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onChange({ amountRaw: e.target.value })}
          onBlur={onTouch}
          className="w-24 shrink-0 text-right"
          data-testid={`payment-composer-amount-${line.method}`}
        />
        {removable && (
          <button type="button" onClick={onRemove} className="shrink-0 rounded p-1 text-[var(--color-text-soft)] hover:bg-[var(--color-danger-50)] hover:text-[var(--color-danger-600)]" aria-label="Quitar">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="border-t border-[var(--color-border)] p-3 pt-2.5">
          {line.method === "CASH" ? (
            <div>
              <div className="mb-2.5 flex items-center justify-between rounded-lg bg-[var(--color-surface-muted)] px-3 py-2">
                <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Recibido</span>
                <span className={["text-lg font-bold tabular-nums", line.receivedRaw ? "text-[var(--color-text)]" : "text-[var(--color-text-soft)]"].join(" ")}>
                  C$ {line.receivedRaw ? received.toFixed(2) : "0.00"}
                </span>
              </div>

              {line.receivedRaw.length > 0 ? (
                <div className={["mb-2.5 rounded-lg px-3 py-2 text-center", validation.insufficientCash ? "border border-[var(--color-danger-200)] bg-[var(--color-danger-50)]" : "border border-[var(--color-warning-200)] bg-[var(--color-warning-50)]"].join(" ")}>
                  {validation.insufficientCash ? (
                    <p className="text-sm font-semibold text-[var(--color-danger-600)]">Falta C$ {(validation.amount - received).toFixed(2)}</p>
                  ) : (
                    <p className="text-sm font-semibold text-[var(--color-warning-700)]">Vuelto C$ {change!.toFixed(2)}</p>
                  )}
                </div>
              ) : null}

              <div className="mb-2.5 grid grid-cols-4 gap-1.5">
                {quickAmounts.map((amt, i) => (
                  <button key={amt} onClick={() => onChange({ receivedRaw: String(amt) })} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:border-[var(--color-pay)] hover:text-[var(--color-pay)] transition-colors" data-testid="payment-composer-quick-amount">
                    {i === 0 ? "Exacto" : `C$${amt}`}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0"].map((d) => (
                  <button key={d} onClick={() => appendDigit(d)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 text-base font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] active:scale-95 transition-[background-color,transform]">
                    {d}
                  </button>
                ))}
                <button onClick={() => onChange({ receivedRaw: line.receivedRaw.slice(0, -1) })} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 flex items-center justify-center text-base text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] active:scale-95 transition-[background-color,transform]" aria-label="Borrar">
                  ⌫
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {line.method === "TRANSFER" && bankAccounts.length > 0 ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                    Cuenta de destino <span className="text-[var(--color-danger-600)]">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={onOpenAccountPicker}
                    data-testid="payment-composer-open-account-picker"
                    className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-left text-sm hover:border-[var(--color-pay)]"
                  >
                    {selectedAccount ? (
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="font-semibold text-[var(--color-text)]">{selectedAccount.bankName}</span>
                          <CurrencyChip currency={selectedAccount.currencyCode} />
                        </span>
                        <span className="block truncate text-xs text-[var(--color-text-muted)]">{selectedAccount.owner ?? selectedAccount.accountAlias}</span>
                      </span>
                    ) : (
                      <span className="text-[var(--color-text-soft)]">Elegí a cuál cuenta entró…</span>
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-text-soft)]" />
                  </button>
                  {line.touched && validation.needsBankAccount ? (
                    <p className="mt-1 text-xs text-[var(--color-danger-600)]">Requerido para transferencias.</p>
                  ) : null}
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                  Número de referencia <span className="text-[var(--color-danger-600)]">*</span>
                </label>
                <input
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-soft)] focus:border-[var(--color-pay)] focus:ring-2 focus:ring-[var(--color-pay)]/10"
                  type="text"
                  value={line.referenceNumber}
                  onChange={(e) => onChange({ referenceNumber: e.target.value })}
                  onBlur={onTouch}
                  placeholder={line.method === "CARD" ? "Nro. de autorización" : "Nro. de transacción"}
                  autoFocus
                  data-testid="payment-composer-reference"
                />
                {line.touched && validation.needsReference ? (
                  <p className="mt-1 text-xs text-[var(--color-danger-600)]">Requerido para {line.method === "CARD" ? "tarjeta" : "transferencia"}.</p>
                ) : null}
              </div>
              {line.method === "CARD" ? <CardSettlementNote /> : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CurrencyChip({ currency }: { currency: string }) {
  const isUsd = currency === "USD";
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide",
        isUsd ? "bg-[var(--color-success-50)] text-[var(--color-success-700)]" : "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
      ].join(" ")}
    >
      {currency === "NIO" ? "Córdobas" : currency === "USD" ? "Dólares" : currency}
    </span>
  );
}

/**
 * Paso propio del diálogo (no una tarjeta anidada) para elegir a qué cuenta
 * entró la transferencia — banco y moneda como titular visual, nombre
 * completo y número completo en monoespaciada grande, botón de copiar para
 * cuando el cajero le dicta la cuenta al cliente
 * (prompt-pantallas-recorrido-dinero.md §1.3). Sin tocar (§4 de la
 * corrección) — solo se le aplicó la misma estructura de tres zonas para
 * que su botón de confirmar también quede siempre visible.
 */
function AccountPickerStep({
  total, accounts, selectedId, onPick, onDone,
}: {
  total: number;
  accounts: BankAccountOption[];
  selectedId: string;
  /** Marca la cuenta elegida — el paso se queda abierto (así se ve la advertencia de moneda antes de confirmar). */
  onPick: (accountId: string) => void;
  /** Vuelve al compositor — con o sin selección; el back-arrow y "Confirmar cuenta" hacen lo mismo. */
  onDone: () => void;
}) {
  async function copyNumber(event: React.MouseEvent, accountNumber: string) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(accountNumber);
      toast.success("Número de cuenta copiado.");
    } catch {
      toast.error("No se pudo copiar el número.");
    }
  }

  const selectedAccount = accounts.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center gap-2.5 pb-3">
        <button type="button" onClick={onDone} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]" aria-label="Volver" data-testid="payment-composer-account-back">
          <ChevronLeft className="h-4.5 w-4.5" />
        </button>
        <div>
          <p className="text-sm font-semibold text-[var(--color-text)]">¿A cuál cuenta entró?</p>
          <p className="text-xs text-[var(--color-text-muted)]">Transferencia de C$ {total.toFixed(2)}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {accounts.map((account) => {
          const selected = account.id === selectedId;
          return (
            <button
              key={account.id}
              type="button"
              onClick={() => onPick(account.id)}
              data-testid="payment-composer-account-card"
              className={[
                "flex w-full items-start justify-between gap-3 rounded-xl border-2 p-3.5 text-left transition-colors",
                selected
                  ? "border-[var(--color-pay)] bg-[var(--color-success-50)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]",
              ].join(" ")}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-[var(--color-text)]">{account.bankName}</span>
                  <CurrencyChip currency={account.currencyCode} />
                </div>
                {account.owner ? (
                  <p className="mt-1 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{account.owner}</p>
                ) : null}
                <p className="mt-0.5 font-mono text-[1.0625rem] tracking-wide text-[var(--color-text)]">{account.accountNumber}</p>
                {account.accountAlias ? <p className="mt-0.5 text-xs text-[var(--color-text-soft)]">{account.accountAlias}</p> : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {selected ? (
                  <Check className="h-5 w-5 text-[var(--color-pay)]" />
                ) : (
                  <button
                    type="button"
                    onClick={(e) => void copyNumber(e, account.accountNumber)}
                    className="rounded-lg p-1.5 text-[var(--color-text-soft)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"
                    aria-label="Copiar número de cuenta"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex-none space-y-2 pt-3">
        {selectedAccount && selectedAccount.currencyCode !== "NIO" && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2.5 text-xs text-[var(--color-warning-700)]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Venta en córdobas a cuenta en {selectedAccount.currencyCode === "USD" ? "dólares" : selectedAccount.currencyCode}. Vas a tener que fijar el tipo de cambio.</span>
          </div>
        )}

        <Button
          variant="success"
          className="w-full rounded-xl py-3 text-sm font-bold"
          onClick={onDone}
          disabled={!selectedId}
          icon={<Check className="h-4 w-4" />}
          data-testid="payment-composer-account-confirm"
        >
          {selectedId ? "Confirmar cuenta" : "Elegí una cuenta"}
        </Button>
      </div>
    </div>
  );
}
