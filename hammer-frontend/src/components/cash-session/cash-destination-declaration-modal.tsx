"use client";

import { useEffect, useState } from "react";
import { Check, Coins, HandCoins, Landmark, Vault, Clock } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDate, formatBankAccountOption, money } from "@/lib/format";
import toast from "react-hot-toast";

type Person = { id: string; fullName: string; username: string };
type BankAccountOption = { id: string; type: string; bankName: string; accountAlias: string; accountNumber: string; currencyCode: string };
/** Mismo shape que Postponement en app/branch/cash-destination/page.tsx. */
type Postponement = { id: string; amount: number; reason: string | null; postponedUntil: string; createdAt: string };

/**
 * prompt-pendientes-2026-09.md Fase 2 (PENDIENTES #3) — si el cajero ya
 * declaró durante la sesión "se queda en la gaveta hasta mañana"
 * (postponeCashDeposit), el cierre debe prellenar Retener con eso en vez
 * de volver a preguntar. Sin posposiciones, se comporta como siempre
 * (retiene todo lo contado). Exportada para poder testearla sin montar el
 * componente (mismo patrón que quickCashAmounts en payment-composer.tsx).
 */
export function initialDeclarationFromPostponements(countedAmount: number, postponements: Pick<Postponement, "amount">[]) {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const postponedTotal = round2(postponements.reduce((sum, p) => sum + p.amount, 0));
  if (postponements.length === 0) {
    return { retainAmount: round2(countedAmount), postponedTotal: 0 };
  }
  return { retainAmount: round2(Math.min(postponedTotal, countedAmount)), postponedTotal };
}

/** Sencillo propuesto: el fondo de la sucursal, sin pasar de lo contado. */
export function initialCashFund(countedAmount: number, cashFundAmount: number | null): number {
  return Math.round(Math.min(Math.max(0, cashFundAmount ?? 0), Math.max(0, countedAmount)) * 100) / 100;
}

/**
 * Se abre al cerrar la caja y no se puede saltar: cada córdoba contado
 * queda asignado — sencillo en la gaveta, resguardado, quién lo lleva o
 * depósito. Si se recarga la página, Caja lo vuelve a pedir
 * (GET pending-declaration).
 */
export function CashDestinationDeclarationModal({
  cashSessionId, branchId, countedAmount, cashFund, onSaved,
}: {
  cashSessionId: string;
  branchId: string;
  countedAmount: number;
  /** Sencillo contado por billetes al cerrar: queda fijo. Sin él (se recargó la página), se anota a mano. */
  cashFund?: { amount: number; note: string } | null;
  onSaved: () => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [fundAmount, setFundAmount] = useState(cashFund ? cashFund.amount.toFixed(2) : "");
  const [handOverAmount, setHandOverAmount] = useState("");
  const [handOverUserId, setHandOverUserId] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositCarrierUserId, setDepositCarrierUserId] = useState("");
  const [depositBankAccountId, setDepositBankAccountId] = useState("");
  const [safeAmount, setSafeAmount] = useState(countedAmount.toFixed(2));
  const [safeLocation, setSafeLocation] = useState<"DRAWER" | "SAFE">("SAFE");
  const [saving, setSaving] = useState(false);
  const [postponements, setPostponements] = useState<Postponement[]>([]);

  useEffect(() => {
    Promise.all([
      apiFetch(`/api/branches/${branchId}/members`).then((r) => (r.ok ? r.json() : null)),
      apiFetch(`/api/master/treasury/bank-accounts?branchId=${branchId}`).then((r) => (r.ok ? r.json() : null)),
      apiFetch("/api/branches").then((r) => (r.ok ? r.json() : null)),
      // Si falla, el modal se comporta como hoy — esto no debe bloquear el cierre.
      apiFetch(`/api/cashier/cash-sessions/${cashSessionId}/cash-destination`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([peopleRaw, accountsRaw, branchesRaw, destinationRaw]) => {
      if (peopleRaw) setPeople((unwrapApiData(peopleRaw) as Person[] | null) ?? []);
      if (accountsRaw) setBankAccounts((unwrapApiData(accountsRaw) as BankAccountOption[] | null) ?? []);
      const branches = branchesRaw ? ((unwrapApiData(branchesRaw) as Array<{ id: string; cashFundAmount: number | null }> | null) ?? []) : [];
      // Sin conteo de sencillo (se recargó), se propone el fondo de la sucursal.
      const sencillo = cashFund ? cashFund.amount : initialCashFund(countedAmount, branches.find((b) => b.id === branchId)?.cashFundAmount ?? null);
      if (!cashFund && sencillo > 0) setFundAmount(sencillo.toFixed(2));
      const summary = destinationRaw ? (unwrapApiData(destinationRaw) as { postponements?: Postponement[] } | null) : null;
      const list = summary?.postponements ?? [];
      setPostponements(list);
      // Con posposiciones, lo retenido arranca en lo ya declarado; si no, todo lo que no es sencillo.
      const retain = list.length > 0 ? initialDeclarationFromPostponements(countedAmount, list).retainAmount : countedAmount;
      setSafeAmount(Math.max(0, retain - sencillo).toFixed(2));
    }).catch(() => {});
    // countedAmount solo se usa para el prefill inicial, que corre una sola vez al abrir el modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, cashSessionId]);

  const fund = Number(fundAmount) || 0;
  const handOver = Number(handOverAmount) || 0;
  const deposit = Number(depositAmount) || 0;
  const safe = Number(safeAmount) || 0;
  const retain = Math.round((fund + safe) * 100) / 100;
  const total = Math.round((fund + handOver + deposit + safe) * 100) / 100;
  const missing = Math.round((countedAmount - total) * 100) / 100;
  const exactMatch = Math.abs(missing) < 0.005;

  // prompt-tesoreria-depositos.md Fase 2 (Bug 2) — el endpoint devuelve
  // cualquier tipo de cuenta activa de la sucursal (CUSTODY/SAFE/SETTLEMENT
  // incluidas); acá solo importan las bancarias. Las de otra moneda se
  // MUESTRAN deshabilitadas, no se ocultan.
  const bankOptions = bankAccounts.filter((a) => a.type === "BANK");
  const nioOptions = bankOptions.filter((a) => a.currencyCode === "NIO");

  const needsHandOverPerson = handOver > 0 && !handOverUserId;
  const needsDepositCarrier = deposit > 0 && !depositCarrierUserId;
  // Cuenta destino obligatoria cuando hay entre cuáles elegir
  // (prompt-pantallas-recorrido-dinero.md §3).
  const needsDepositAccount = deposit > 0 && nioOptions.length > 0 && !depositBankAccountId;
  const canConfirm = !saving && exactMatch && !needsHandOverPerson && !needsDepositCarrier && !needsDepositAccount;

  const postponedTotal = initialDeclarationFromPostponements(countedAmount, postponements).postponedTotal;
  const exceedsCounted = postponedTotal > countedAmount + 0.005;
  // Informativo, no bloquea: solo avisa que está cambiando algo que ya había declarado antes.
  const belowPostponed = postponedTotal > 0 && retain < postponedTotal - 0.005;

  async function submit() {
    if (!canConfirm) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/cashier/cash-sessions/${cashSessionId}/destination-declaration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cashSessionId,
          branchId,
          handOverAmount: handOver,
          handOverUserId: handOver > 0 ? handOverUserId : null,
          depositAmount: deposit,
          depositCarrierUserId: deposit > 0 ? depositCarrierUserId : null,
          depositBankAccountId: deposit > 0 ? (depositBankAccountId || null) : null,
          retainAmount: retain,
          cashFundAmount: fund,
          awaitingDepositLocation: safe > 0 ? safeLocation : "DRAWER",
          notes: cashFund?.note ? `Sencillo: ${cashFund.note}` : null,
        }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo registrar el destino.");
      toast.success("Destino del efectivo registrado.");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar el destino.");
    } finally {
      setSaving(false);
    }
  }

  // Al tocar cualquier monto, lo resguardado absorbe el resto: el caso común no exige tocar nada.
  function rebalance(next: { fund?: string; handOver?: string; deposit?: string }) {
    const f = Number(next.fund ?? fundAmount) || 0;
    const h = Number(next.handOver ?? handOverAmount) || 0;
    const d = Number(next.deposit ?? depositAmount) || 0;
    setSafeAmount(Math.max(0, Math.round((countedAmount - f - h - d) * 100) / 100).toFixed(2));
  }

  const row = "rounded-lg border border-[var(--color-border)] p-3";
  const rowTitle = "mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text)]";
  const hint = "mt-1 text-[0.6875rem]";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="cash-destination-title">
      <div className="max-h-[100dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-2xl bg-[var(--color-surface)] p-5 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-xl" data-testid="cash-destination-declaration">
        <div>
          <h3 id="cash-destination-title" className="text-base font-semibold text-[var(--color-text)]">¿Dónde queda el dinero?</h3>
          <p className="text-sm text-[var(--color-text-muted)]">Contaste {money(countedAmount)}. El sencillo se queda; asigna el resto antes de seguir.</p>
        </div>

        {postponements.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2.5 text-[13px] text-[var(--color-warning-700)]">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              {postponements.length === 1 ? (
                <span>
                  Ya declaraste que {money(postponements[0].amount)} se queda hasta el {fmtDate(postponements[0].postponedUntil)}
                  {postponements[0].reason ? ` — ${postponements[0].reason}` : ""}.
                </span>
              ) : (
                <>
                  <span>Ya declaraste {money(postponedTotal)} pospuestos en {postponements.length} veces durante esta sesión:</span>
                  <ul className="ml-4 list-disc space-y-0.5">
                    {postponements.map((p) => (
                      <li key={p.id}>
                        {money(p.amount)} hasta el {fmtDate(p.postponedUntil)}{p.reason ? ` — ${p.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {exceedsCounted && (
                <p className="font-semibold">Lo pospuesto ({money(postponedTotal)}) supera lo contado ahora ({money(countedAmount)}).</p>
              )}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className={row} data-testid="cash-destination-fund">
            <label htmlFor="dest-fund" className={rowTitle}>
              <Coins className="h-3.5 w-3.5" aria-hidden="true" /> Sencillo en la gaveta
            </label>
            {cashFund ? (
              <>
                <p className="text-lg font-semibold tabular-nums text-[var(--color-text)]">{money(cashFund.amount)}</p>
                <p className={`${hint} text-[var(--color-text-soft)]`}>
                  {cashFund.note ? `${cashFund.note}. ` : ""}Se queda en la gaveta para abrir mañana.
                </p>
              </>
            ) : (
              <>
                <Input id="dest-fund" type="number" inputMode="decimal" min="0" step="0.01" value={fundAmount}
                  onChange={(e) => { setFundAmount(e.target.value); rebalance({ fund: e.target.value }); }} placeholder="0.00" />
                <p className={`${hint} text-[var(--color-text-soft)]`}>Se queda en la gaveta para abrir mañana.</p>
              </>
            )}
          </div>

          <div className={row}>
            <label htmlFor="dest-safe" className={rowTitle}>
              <Vault className="h-3.5 w-3.5" aria-hidden="true" /> Resguardado
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input id="dest-safe" type="number" inputMode="decimal" min="0" step="0.01" value={safeAmount} onChange={(e) => setSafeAmount(e.target.value)} placeholder="0.00" />
              {safe > 0 && (
                <select className="hm-input" value={safeLocation} onChange={(e) => setSafeLocation(e.target.value as "DRAWER" | "SAFE")} aria-label="Dónde queda resguardado">
                  <option value="SAFE">Caja fuerte</option>
                  <option value="DRAWER">Gaveta</option>
                </select>
              )}
            </div>
            {belowPostponed && (
              <p className={`${hint} text-[var(--color-warning-700)]`}>
                Esto es menos de lo que ya declaraste pospuesto ({money(postponedTotal)}): estás cambiando lo que dijiste antes.
              </p>
            )}
          </div>

          <div className={row}>
            <label htmlFor="dest-handover" className={rowTitle}>
              <HandCoins className="h-3.5 w-3.5" aria-hidden="true" /> Lo lleva una persona
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input id="dest-handover" type="number" inputMode="decimal" min="0" step="0.01" value={handOverAmount}
                onChange={(e) => { setHandOverAmount(e.target.value); rebalance({ handOver: e.target.value }); }} placeholder="0.00" />
              {handOver > 0 && (
                <select className="hm-input" value={handOverUserId} onChange={(e) => setHandOverUserId(e.target.value)} aria-label="Quién lo lleva">
                  <option value="">¿Quién lo lleva?</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
                </select>
              )}
            </div>
            {needsHandOverPerson && <p className={`${hint} text-[var(--color-danger-600)]`}>Falta quién lo lleva.</p>}
          </div>

          <div className={row}>
            <label htmlFor="dest-deposit" className={rowTitle}>
              <Landmark className="h-3.5 w-3.5" aria-hidden="true" /> Depositar
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input id="dest-deposit" type="number" inputMode="decimal" min="0" step="0.01" value={depositAmount}
                onChange={(e) => { setDepositAmount(e.target.value); rebalance({ deposit: e.target.value }); }} placeholder="0.00" />
              {deposit > 0 && (
                <select className="hm-input" value={depositCarrierUserId} onChange={(e) => setDepositCarrierUserId(e.target.value)} aria-label="Quién lleva el depósito">
                  <option value="">¿Quién lo lleva?</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
                </select>
              )}
            </div>
            {deposit > 0 && bankOptions.length > 0 && (
              <>
                <select className="hm-input mt-2 w-full" value={depositBankAccountId} onChange={(e) => setDepositBankAccountId(e.target.value)} aria-label="Cuenta destino">
                  <option value="">Cuenta destino…</option>
                  {bankOptions.map((a) => (
                    <option key={a.id} value={a.id} disabled={a.currencyCode !== "NIO"}>
                      {formatBankAccountOption(a)}{a.currencyCode !== "NIO" ? " — no admite efectivo en córdobas" : ""}
                    </option>
                  ))}
                </select>
                <p className={`${hint} text-[var(--color-text-soft)]`}>Se acreditará en C$ (córdobas).</p>
              </>
            )}
            {needsDepositCarrier && <p className={`${hint} text-[var(--color-danger-600)]`}>Falta quién lo lleva.</p>}
            {needsDepositAccount && <p className={`${hint} text-[var(--color-danger-600)]`}>Falta la cuenta destino.</p>}
          </div>
        </div>

        <div
          className={["flex items-center justify-between rounded-xl px-4 py-2.5 text-sm font-semibold",
            exactMatch ? "border border-[var(--color-success-200)] bg-[var(--color-success-50)] text-[var(--color-success-700)]" : "border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] text-[var(--color-danger-600)]"].join(" ")}
          aria-live="polite"
          data-testid="cash-destination-balance"
        >
          <span>Asignado {money(total)}</span>
          <span>{missing > 0 ? `Falta ${money(missing)}` : missing < 0 ? `Sobra ${money(Math.abs(missing))}` : "Exacto"}</span>
        </div>

        <Button variant="success" className="w-full" onClick={() => void submit()} disabled={!canConfirm} loading={saving} icon={<Check className="h-4 w-4" />}>
          Confirmar destino
        </Button>
      </div>
    </div>
  );
}
