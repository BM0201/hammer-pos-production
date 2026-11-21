"use client";

import { useEffect, useMemo, useState } from "react";
import { Banknote, CreditCard, ArrowLeftRight, DollarSign, Plus, X, Check, ChevronRight, ChevronLeft, Copy, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, numFixed, usdMoney } from "@/lib/format";
import toast from "react-hot-toast";

/**
 * Composición de pago compartida entre el diálogo de cobro del POS
 * (charge-dialog.tsx) y la cola de cajero (cashier-payments.tsx).
 *
 * Caso normal (casi todos los cobros): "¿Cómo paga?" con cuatro botones
 * grandes — Efectivo, Dólares, Tarjeta, Transferencia — y solo la pregunta de
 * ese método. El botón final dice lo que va a pasar ("Cobrar C$1,335 en
 * efectivo"). "Paga con dos formas" abre la lista de líneas para armar el pago
 * hasta cubrir el total (PaymentTender / MIXED en el backend).
 *
 * Dólares: el cliente entrega US$, el vuelto sale en córdobas. Se manda como
 * un tender CASH con `receivedUsdAmount`; el servidor recalcula con la tasa
 * vigente y la caja espera esos US$ aparte de los córdobas.
 */

export type TenderMethod = "CASH" | "CARD" | "TRANSFER";
/** Lo que elige el cajero: los dólares son efectivo, pero se preguntan distinto. */
type PayChoice = TenderMethod | "USD";

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
  /** Solo cobro en dólares: US$ que entregó el cliente (receivedAmount es su equivalente en C$). */
  receivedUsdAmount?: number;
  referenceNumber?: string | null;
  bankAccountId?: string | null;
};

type DraftLine = {
  id: string;
  method: PayChoice;
  amountRaw: string;
  receivedRaw: string;
  usdRaw: string;
  referenceNumber: string;
  bankAccountId: string;
  /** Solo gatilla CUÁNDO se muestran los errores (al confirmar o al salir del campo, nunca al abrir). */
  touched: boolean;
};

const METHOD_META: Record<PayChoice, { label: string; icon: typeof Banknote; action: string }> = {
  CASH: { label: "Efectivo", icon: Banknote, action: "en efectivo" },
  USD: { label: "Dólares", icon: DollarSign, action: "en dólares" },
  CARD: { label: "Tarjeta", icon: CreditCard, action: "con tarjeta" },
  TRANSFER: { label: "Transferencia", icon: ArrowLeftRight, action: "por transferencia" },
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * US$ → C$ a 2 decimales, redondeo hacia arriba en .5 — en enteros (centavos ×
 * diezmilésimas) para dar exactamente lo mismo que el servidor (Decimal
 * ROUND_HALF_UP); con flotantes 40 × 36.6243 podía caer del otro lado del .5.
 */
export function usdToNio(usd: number, rate: number): number {
  return Math.round((Math.round(usd * 100) * Math.round(rate * 10000)) / 10000) / 100;
}

function nextId(existing: DraftLine[]) {
  return String(existing.reduce((max, l) => Math.max(max, Number(l.id) || 0), 0) + 1);
}

function newLine(method: PayChoice, amount: number, existing: DraftLine[]): DraftLine {
  return {
    id: nextId(existing),
    method,
    amountRaw: amount > 0 ? amount.toFixed(2) : "",
    receivedRaw: "",
    usdRaw: "",
    referenceNumber: "",
    bankAccountId: "",
    touched: false,
  };
}

const BILLETES = [50, 100, 200, 500, 1000] as const;
const BILLETE_MAYOR = 1000;

/**
 * Montos con los que realmente te pagan un total dado. El exacto primero;
 * después el siguiente múltiplo de 50; después las denominaciones de billete
 * que superan el total; si ninguna alcanza, múltiplos del billete mayor.
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

/** Dólares con los que te pagan un total en C$: el mínimo que alcanza y los billetes redondos que siguen. */
export function quickUsdAmounts(total: number, rate: number): number[] {
  if (!(total > 0) || !(rate > 0)) return [];
  let min = Math.ceil(total / rate);
  if (usdToNio(min, rate) < total) min += 1;
  const out: number[] = [min];
  for (const step of [5, 10, 20, 50, 100]) {
    if (out.length >= 4) break;
    const candidate = Math.ceil(min / step) * step;
    if (!out.includes(candidate)) out.push(candidate);
  }
  return out;
}

type LineValidation = {
  amount: number;
  /** C$ recibidos (efectivo: lo que entregó; dólares: su equivalente). */
  received: number;
  valid: boolean;
  needsReference: boolean;
  needsBankAccount: boolean;
  needsUsd: boolean;
  insufficientCash: boolean;
};

/**
 * `accountsAvailable`: si la sucursal todavía no tiene cuentas cargadas, la
 * cuenta de destino no se exige — no se puede pedir un dato que no existe.
 */
function validateLine(line: DraftLine, accountsAvailable: boolean, usdRate: number | null): LineValidation {
  const amount = Number(line.amountRaw) || 0;
  const base = { amount, received: amount, needsReference: false, needsBankAccount: false, needsUsd: false, insufficientCash: false };
  if (line.method === "CASH") {
    const received = line.receivedRaw.length > 0 ? Number(line.receivedRaw) || 0 : amount;
    const insufficientCash = received < amount;
    return { ...base, received, valid: amount > 0 && !insufficientCash, insufficientCash };
  }
  if (line.method === "USD") {
    const usd = Number(line.usdRaw) || 0;
    const received = usdRate && usd > 0 ? usdToNio(usd, usdRate) : 0;
    const needsUsd = !(usd > 0) || !usdRate;
    const insufficientCash = !needsUsd && received < amount;
    return { ...base, received, valid: amount > 0 && !needsUsd && !insufficientCash, needsUsd, insufficientCash };
  }
  const needsReference = !line.referenceNumber.trim();
  const needsBankAccount = line.method === "TRANSFER" && accountsAvailable && !line.bankAccountId;
  return { ...base, valid: amount > 0 && !needsReference && !needsBankAccount, needsReference, needsBankAccount };
}

export type PaymentComposerProps = {
  total: number;
  isSubmitting?: boolean;
  onSubmit: (tenders: ComposedTender[]) => void;
  /** Métodos ofrecidos — por defecto los tres. */
  availableMethods?: TenderMethod[];
  /** Cuentas propias para "¿a qué cuenta entró?" en transferencias. Sin cuentas cargadas, no se pide. */
  bankAccounts?: BankAccountOption[];
};

export function PaymentComposer({
  total,
  isSubmitting = false,
  onSubmit,
  availableMethods = ["CASH", "CARD", "TRANSFER"],
  bankAccounts = [],
}: PaymentComposerProps) {
  // Tasa USD→NIO que fijó Master en Tesorería; sin tasa no se cobra en dólares.
  const [usdRate, setUsdRate] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    apiFetch("/api/cashier/exchange-rate")
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        const rate = raw ? Number((unwrapApiData(raw) as { usdToNioRate: number | null }).usdToNioRate) : 0;
        if (alive) setUsdRate(rate > 0 ? rate : null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const choices: PayChoice[] = availableMethods.includes("CASH")
    ? availableMethods.flatMap((m): PayChoice[] => (m === "CASH" ? ["CASH", "USD"] : [m]))
    : availableMethods;
  // Sin método elegido de entrada: el cajero tiene que decir cómo pagó. Antes arrancaba en
  // Efectivo y una transferencia cobrada de un clic quedaba como efectivo (la caja salía corta).
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [pickerLineId, setPickerLineId] = useState<string | null>(null);
  const [mixed, setMixed] = useState(false);
  const accountsAvailable = bankAccounts.length > 0;

  /** Un método = una sola línea por el total completo. */
  function choose(method: PayChoice) {
    setMixed(false);
    const line = newLine(method, total, []);
    setLines([line]);
    if (method === "TRANSFER" && accountsAvailable) setPickerLineId(line.id);
  }

  function startMixed() {
    setMixed(true);
    // La línea que ya estaba queda como primera forma; la segunda se agrega con los botones de abajo.
    // Cuánto cubre se anota a mano (los dólares cubren su equivalente).
    setLines((prev) =>
      prev.slice(0, 1).map((l) => {
        const usd = Number(l.usdRaw) || 0;
        const amountRaw = l.method === "USD" && usdRate && usd > 0 ? usdToNio(usd, usdRate).toFixed(2) : "";
        return { ...l, amountRaw, receivedRaw: "" };
      }),
    );
  }

  const validations = useMemo(() => lines.map((l) => validateLine(l, accountsAvailable, usdRate)), [lines, accountsAvailable, usdRate]);
  const covered = useMemo(() => round2(validations.reduce((sum, v) => sum + v.amount, 0)), [validations]);
  const missing = round2(total - covered);
  const exactMatch = Math.abs(missing) < 0.005;
  const allLinesValid = validations.every((v) => v.valid);
  const canConfirm = !isSubmitting && lines.length > 0 && exactMatch && allLinesValid;
  const single = lines[0];

  function updateLine(id: string, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        // En dos formas, lo que se aplica de los dólares es su equivalente: nunca hay vuelto en esa línea.
        if (mixed && next.method === "USD" && patch.usdRaw !== undefined) {
          const usd = Number(next.usdRaw) || 0;
          next.amountRaw = usdRate && usd > 0 ? usdToNio(usd, usdRate).toFixed(2) : "";
        }
        return next;
      }),
    );
  }

  function touchLine(id: string) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, touched: true } : l)));
  }

  function removeLine(id: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
  }

  function addLine(method: PayChoice) {
    const line = newLine(method, method === "USD" ? 0 : Math.max(missing, 0), lines);
    setLines((prev) => [...prev, line]);
    if (method === "TRANSFER" && accountsAvailable) setPickerLineId(line.id);
  }

  function confirm() {
    if (!canConfirm) {
      setLines((prev) => prev.map((l) => ({ ...l, touched: true })));
      return;
    }
    const tenders: ComposedTender[] = lines.map((line, i) => {
      const v = validations[i];
      if (line.method === "CASH" || line.method === "USD") {
        return {
          method: "CASH",
          amount: v.amount,
          receivedAmount: round2(v.received),
          changeAmount: round2(v.received - v.amount),
          ...(line.method === "USD" ? { receivedUsdAmount: Number(line.usdRaw) } : {}),
        };
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

  const submitText = mixed
    ? exactMatch
      ? `Cobrar ${money(total)} en ${lines.length} formas`
      : missing > 0
        ? `Falta ${money(missing)}`
        : `Sobra ${money(-missing)}`
    : !single
      ? "Elige cómo paga"
      : single.method === "USD" && validations[0]?.needsUsd
      ? "Anota cuántos dólares entrega"
      : `Cobrar ${money(total)} ${METHOD_META[single.method].action}`;

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      {/* ¿Cómo paga? — Alt+1..4 en computadora (ver ChargeDialog). */}
      <div className="mb-3 flex-none">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{mixed ? "Paga con dos formas" : "¿Cómo paga?"}</p>
        <div className={mixed ? "hidden" : "grid grid-cols-2 gap-2 @md:grid-cols-4"} data-testid="payment-composer-tabs">
          {choices.map((m) => {
            const Meta = METHOD_META[m];
            const active = !mixed && single?.method === m;
            const noRate = m === "USD" && !usdRate;
            return (
              <button
                key={m}
                type="button"
                data-testid={`payment-composer-tab-${m}`}
                onClick={() => choose(m)}
                disabled={isSubmitting || noRate}
                aria-pressed={active}
                title={noRate ? "Master debe fijar el tipo de cambio en Tesorería" : undefined}
                className={[
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-2 text-sm font-semibold transition-colors",
                  active
                    ? "border-[var(--color-pay)] bg-[var(--color-pay)]/10 text-[var(--color-pay)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-pay)]",
                  noRate ? "cursor-not-allowed opacity-50" : "",
                ].join(" ")}
              >
                <Meta.icon className="h-5 w-5" />
                {Meta.label}
              </button>
            );
          })}
        </div>
        {!mixed && choices.includes("USD") && !usdRate ? (
          <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">Dólares: Master debe fijar el tipo de cambio en Tesorería.</p>
        ) : null}
        {!mixed && choices.length > 1 ? (
          <button
            type="button"
            onClick={startMixed}
            disabled={isSubmitting}
            className="mt-2 text-xs font-semibold text-[var(--color-pay)] underline-offset-2 hover:underline pointer-coarse:py-2"
            data-testid="payment-composer-mixed"
          >
            Paga con dos formas
          </button>
        ) : null}
      </div>

      {/* Cuerpo — única área con scroll. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {mixed ? (
          <div className="space-y-2">
            <div
              className={[
                "flex items-center justify-between rounded-xl px-4 py-2.5 text-sm font-semibold",
                exactMatch
                  ? "border border-[var(--color-success-200)] bg-[var(--color-success-50)] text-[var(--color-success-700)]"
                  : "border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] text-[var(--color-danger-600)]",
              ].join(" ")}
            >
              <span>Cubierto {money(covered)}</span>
              <span>{exactMatch ? "Completo" : missing > 0 ? `Falta ${money(missing)}` : `Sobra ${money(-missing)}`}</span>
            </div>
            {lines.map((line, i) => (
              <LineItem
                key={line.id}
                line={line}
                validation={validations[i]}
                removable={lines.length > 1}
                bankAccounts={bankAccounts}
                usdRate={usdRate}
                onChange={(patch) => updateLine(line.id, patch)}
                onTouch={() => touchLine(line.id)}
                onRemove={() => removeLine(line.id)}
                onOpenAccountPicker={() => setPickerLineId(line.id)}
              />
            ))}
          </div>
        ) : single ? (
          <MethodBody
            key={single.id + single.method}
            line={single}
            validation={validations[0]}
            total={total}
            bankAccounts={bankAccounts}
            usdRate={usdRate}
            onChange={(patch) => updateLine(single.id, patch)}
            onTouch={() => touchLine(single.id)}
            onOpenAccountPicker={() => setPickerLineId(single.id)}
          />
        ) : (
          <p className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-6 text-center text-sm text-[var(--color-text-muted)]" data-testid="payment-composer-choose-hint">
            Toca cómo pagó el cliente. Si fue transferencia o tarjeta, no lo cobres como efectivo: la caja no cuadra.
          </p>
        )}
      </div>

      {/* Pie fijo: agregar forma (solo en dos formas) + confirmar. */}
      <div className="flex-none space-y-2 pt-3">
        {mixed && (
          <div className="flex flex-wrap items-center gap-1.5">
            {choices
              .filter((method) => !lines.some((l) => l.method === method) || method === "CARD" || method === "TRANSFER")
              .filter((method) => method !== "USD" || usdRate)
              .map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => addLine(method)}
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-pay)] hover:text-[var(--color-pay)] pointer-coarse:py-2.5"
                >
                  <Plus className="h-3 w-3" /> {METHOD_META[method].label}
                </button>
              ))}
            <button
              type="button"
              onClick={() => {
                setMixed(false);
                setLines([]);
              }}
              disabled={isSubmitting}
              className="ml-auto text-xs font-semibold text-[var(--color-text-muted)] hover:underline pointer-coarse:py-2.5"
            >
              Una sola forma
            </button>
          </div>
        )}

        <Button
          variant="success"
          className="w-full rounded-xl py-3 text-base font-bold"
          onClick={confirm}
          disabled={isSubmitting || !exactMatch}
          loading={isSubmitting}
          icon={<Check className="h-5 w-5" />}
          data-testid="payment-composer-confirm"
        >
          {submitText}
        </Button>
      </div>
    </div>
  );
}

/** El cuerpo de un cobro de una sola forma: solo la pregunta de ese método. */
function MethodBody({
  line, validation, total, bankAccounts, usdRate, onChange, onTouch, onOpenAccountPicker,
}: {
  line: DraftLine;
  validation: LineValidation;
  total: number;
  bankAccounts: BankAccountOption[];
  usdRate: number | null;
  onChange: (patch: Partial<DraftLine>) => void;
  onTouch: () => void;
  onOpenAccountPicker: () => void;
}) {
  if (line.method === "CASH") {
    const change = round2(validation.received - total);
    return (
      <ReceivedPad
        label="¿Con cuánto paga?"
        prefix="C$"
        value={line.receivedRaw}
        onChange={(receivedRaw) => onChange({ receivedRaw })}
        quickAmounts={quickCashAmounts(total)}
        quickLabel={(amt, i) => (i === 0 ? "Exacto" : `C$${amt}`)}
        result={
          validation.insufficientCash ? (
            <ResultCard tone="danger" label="Falta" value={money(total - validation.received)} />
          ) : line.receivedRaw ? (
            <ResultCard tone="change" label="Vuelto" value={money(change)} />
          ) : (
            <p className="text-center text-xs text-[var(--color-text-muted)]">Si paga exacto, toca Cobrar.</p>
          )
        }
      />
    );
  }

  if (line.method === "USD" && usdRate) {
    const usd = Number(line.usdRaw) || 0;
    return (
      <ReceivedPad
        label="¿Cuántos dólares entrega?"
        prefix="US$"
        value={line.usdRaw}
        onChange={(usdRaw) => onChange({ usdRaw })}
        quickAmounts={quickUsdAmounts(total, usdRate)}
        quickLabel={(amt) => `US$${amt}`}
        result={
          <div className="space-y-1.5">
            {usd > 0 ? (
              <p className="text-center text-sm text-[var(--color-text-secondary)]" data-testid="payment-composer-usd-equivalent">
                {usdMoney(usd)} equivale a <b className="text-[var(--color-text)]">{money(validation.received)}</b>
              </p>
            ) : null}
            {validation.insufficientCash ? (
              <ResultCard tone="danger" label="Falta" value={money(total - validation.received)} />
            ) : usd > 0 ? (
              <ResultCard tone="change" label="Vuelto en córdobas" value={money(validation.received - total)} />
            ) : null}
            <p className="text-center text-[0.6875rem] text-[var(--color-text-muted)]">
              Tipo de cambio {numFixed(usdRate, 4)} · el vuelto se da en córdobas
            </p>
          </div>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-[var(--color-surface-muted)] px-4 py-3 text-center">
        <p className="text-xs text-[var(--color-text-muted)]">Se cobra {METHOD_META[line.method].action}</p>
        <p className="text-2xl font-bold tabular-nums text-[var(--color-text)]">{money(total)}</p>
      </div>
      <ReferenceFields line={line} validation={validation} bankAccounts={bankAccounts} onChange={onChange} onTouch={onTouch} onOpenAccountPicker={onOpenAccountPicker} />
    </div>
  );
}

function ResultCard({ tone, label, value }: { tone: "change" | "danger"; label: string; value: string }) {
  return (
    <div
      className={[
        "flex items-center justify-between rounded-xl px-4 py-3",
        tone === "danger"
          ? "border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] text-[var(--color-danger-600)]"
          : "border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
      ].join(" ")}
      data-testid="payment-composer-result"
    >
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Campo de "cuánto entrega" con montos rápidos y teclado en pantalla. El
 * teclado solo aparece solo en pantallas táctiles; con mouse y teclado queda
 * el botón "Mostrar teclado".
 */
function ReceivedPad({
  label, prefix, value, onChange, quickAmounts, quickLabel, result,
}: {
  label: string;
  prefix: string;
  value: string;
  onChange: (value: string) => void;
  quickAmounts: number[];
  quickLabel: (amount: number, index: number) => string;
  result: React.ReactNode;
}) {
  const [showKeypad, setShowKeypad] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);

  function appendDigit(digit: string) {
    if (digit === "00" && !value) return;
    const next = value + digit;
    if (next.replace(".", "").length > 10) return;
    onChange(next);
  }

  return (
    <div className="space-y-2.5">
      <div>
        <label className="mb-1 block text-sm font-semibold text-[var(--color-text)]">{label}</label>
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-3 focus-within:border-[var(--color-pay)]">
            <span className="text-base font-semibold text-[var(--color-text-muted)]">{prefix}</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              className="w-full bg-transparent px-2 py-2.5 text-right text-2xl font-bold tabular-nums text-[var(--color-text)] outline-none focus-visible:outline-none!"
              placeholder="0.00"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              autoFocus
              aria-label={label}
              data-testid="payment-composer-received"
            />
          </div>
          {!showKeypad ? (
            <button type="button" onClick={() => setShowKeypad(true)} className="shrink-0 rounded-lg border border-[var(--color-border)] px-2.5 py-2 text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">
              Teclado
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {quickAmounts.map((amt, i) => (
          <button
            key={amt}
            type="button"
            onClick={() => onChange(String(amt))}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 text-sm font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-pay)] hover:text-[var(--color-pay)] pointer-coarse:py-3"
            data-testid="payment-composer-quick-amount"
          >
            {quickLabel(amt, i)}
          </button>
        ))}
      </div>

      {result}

      {showKeypad ? (
        <div className="grid grid-cols-3 gap-1.5">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0"].map((d) => (
            <button key={d} type="button" onClick={() => appendDigit(d)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 text-base font-semibold text-[var(--color-text)] transition-[background-color,transform] hover:bg-[var(--color-surface-alt)] active:scale-95">
              {d}
            </button>
          ))}
          <button type="button" onClick={() => onChange(value.slice(0, -1))} className="flex items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 text-base text-[var(--color-text-secondary)] transition-[background-color,transform] hover:bg-[var(--color-surface-alt)] active:scale-95" aria-label="Borrar">
            ⌫
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Texto bajo una línea de tarjeta: la plata de tarjeta se liquida a 1-2 días menos comisión. */
function CardSettlementNote() {
  return (
    <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-[var(--color-warning-50)] px-2.5 py-2 text-[0.6875rem] text-[var(--color-warning-700)]">
      <AlertTriangle className="h-3 w-3 shrink-0" />
      <span>Se liquida en 1–2 días menos comisión · queda en <b>Por liquidar</b>, no en el banco</span>
    </p>
  );
}

/** Cuenta de destino (transferencia) + número de referencia (tarjeta y transferencia). */
function ReferenceFields({
  line, validation, bankAccounts, onChange, onTouch, onOpenAccountPicker,
}: {
  line: DraftLine;
  validation: LineValidation;
  bankAccounts: BankAccountOption[];
  onChange: (patch: Partial<DraftLine>) => void;
  onTouch: () => void;
  onOpenAccountPicker: () => void;
}) {
  const selectedAccount = bankAccounts.find((a) => a.id === line.bankAccountId) ?? null;
  return (
    <div className="space-y-2.5">
      {line.method === "TRANSFER" && bankAccounts.length > 0 ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
            ¿A qué cuenta entró? <span className="text-[var(--color-danger-600)]">*</span>
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
          {line.touched && validation.needsBankAccount ? <p className="mt-1 text-xs text-[var(--color-danger-600)]">Requerido para transferencias.</p> : null}
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
  );
}

/** Una forma de pago dentro de "Paga con dos formas": método, cuánto cubre y su dato propio. */
function LineItem({
  line, validation, removable, bankAccounts, usdRate, onChange, onTouch, onRemove, onOpenAccountPicker,
}: {
  line: DraftLine;
  validation: LineValidation;
  removable: boolean;
  bankAccounts: BankAccountOption[];
  usdRate: number | null;
  onChange: (patch: Partial<DraftLine>) => void;
  onTouch: () => void;
  onRemove: () => void;
  onOpenAccountPicker: () => void;
}) {
  const Meta = METHOD_META[line.method];
  const isUsd = line.method === "USD";
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5">
      <div className="flex items-center gap-2">
        <Meta.icon className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
        <span className="shrink-0 text-sm font-semibold text-[var(--color-text)]">{Meta.label}</span>
        {isUsd ? (
          <span className="ml-auto text-sm font-semibold tabular-nums text-[var(--color-text)]">{money(validation.amount)}</span>
        ) : (
          <label className="ml-auto flex items-center gap-1 whitespace-nowrap text-xs text-[var(--color-text-muted)]">
            Cubre C$
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={line.amountRaw}
              onChange={(e) => onChange({ amountRaw: e.target.value })}
              onBlur={onTouch}
              className="w-24 shrink-0 text-right"
              data-testid={`payment-composer-amount-${line.method}`}
            />
          </label>
        )}
        {removable && (
          <button type="button" onClick={onRemove} className="shrink-0 rounded p-1 text-[var(--color-text-soft)] hover:bg-[var(--color-danger-50)] hover:text-[var(--color-danger-600)] pointer-coarse:p-3" aria-label="Quitar">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="mt-2">
        {line.method === "CASH" ? (
          <div className="flex items-center gap-2">
            <label className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">Entrega C$</label>
            <input
              type="number"
              inputMode="decimal"
              className="hm-input w-28 text-right"
              placeholder={line.amountRaw || "0.00"}
              value={line.receivedRaw}
              onChange={(e) => onChange({ receivedRaw: e.target.value })}
            />
            {line.receivedRaw ? (
              <span className={["ml-auto text-sm font-semibold tabular-nums", validation.insufficientCash ? "text-[var(--color-danger-600)]" : "text-[var(--color-warning-700)]"].join(" ")}>
                {validation.insufficientCash ? `Falta ${money(validation.amount - validation.received)}` : `Vuelto ${money(validation.received - validation.amount)}`}
              </span>
            ) : null}
          </div>
        ) : isUsd ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">Entrega US$</label>
            <input
              type="number"
              inputMode="decimal"
              className="hm-input w-28 text-right"
              placeholder="0.00"
              value={line.usdRaw}
              onChange={(e) => onChange({ usdRaw: e.target.value })}
              onBlur={onTouch}
              autoFocus
            />
            {usdRate ? <span className="text-[0.6875rem] text-[var(--color-text-muted)]">a {numFixed(usdRate, 4)} · sin vuelto en esta forma</span> : null}
          </div>
        ) : (
          <ReferenceFields line={line} validation={validation} bankAccounts={bankAccounts} onChange={onChange} onTouch={onTouch} onOpenAccountPicker={onOpenAccountPicker} />
        )}
      </div>
    </div>
  );
}

function CurrencyChip({ currency }: { currency: string }) {
  const isUsd = currency === "USD";
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide",
        isUsd ? "bg-[var(--color-success-50)] text-[var(--color-success-700)]" : "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
      ].join(" ")}
    >
      {currency === "NIO" ? "Córdobas" : currency === "USD" ? "Dólares" : currency}
    </span>
  );
}

/**
 * Paso propio del diálogo para elegir a qué cuenta entró la transferencia —
 * lista compacta con radio; "Copiar" copia el número COMPLETO.
 */
function AccountPickerStep({
  total, accounts, selectedId, onPick, onDone,
}: {
  total: number;
  accounts: BankAccountOption[];
  selectedId: string;
  /** Marca la cuenta elegida — el paso se queda abierto (así se ve la advertencia de moneda antes de confirmar). */
  onPick: (accountId: string) => void;
  /** Vuelve al compositor — con o sin selección. */
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
        <button type="button" onClick={onDone} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] pointer-coarse:p-3" aria-label="Volver" data-testid="payment-composer-account-back">
          <ChevronLeft className="h-4.5 w-4.5" />
        </button>
        <div>
          <p className="text-sm font-semibold text-[var(--color-text)]">¿A cuál cuenta entró?</p>
          <p className="text-xs text-[var(--color-text-muted)]">Transferencia de {money(total)}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg" style={{ border: "0.5px solid var(--color-border)" }}>
        {accounts.map((account, i) => {
          const selected = account.id === selectedId;
          const last4 = account.accountNumber.slice(-4);
          return (
            <button
              key={account.id}
              type="button"
              onClick={() => onPick(account.id)}
              data-testid="payment-composer-account-card"
              className={[
                "flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors",
                i > 0 ? "border-t" : "",
                selected ? "bg-[var(--color-success-50)]" : "hover:bg-[var(--color-surface-alt)]",
              ].join(" ")}
              style={{ borderColor: "var(--color-border)" }}
            >
              <span
                className={["flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-[var(--color-pay)]" : "border-[var(--color-border-strong)]"].join(" ")}
                aria-hidden="true"
              >
                {selected && <span className="h-2 w-2 rounded-full bg-[var(--color-pay)]" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-semibold text-[var(--color-text)]">{account.bankName}</span>
                {" · "}
                <CurrencyChip currency={account.currencyCode} />
                {account.owner && <span className="text-[var(--color-text-muted)]"> · {account.owner}</span>}
                <span className="font-mono text-[var(--color-text-muted)]"> · ****{last4}</span>
              </span>
              <button
                type="button"
                onClick={(e) => void copyNumber(e, account.accountNumber)}
                className="shrink-0 rounded-lg p-1.5 text-[var(--color-text-soft)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"
                aria-label="Copiar número completo"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
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
