"use client";

import { useEffect, useState } from "react";
import { Check, X, HandCoins, Landmark, Vault, Clock } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/format";
import toast from "react-hot-toast";

type Person = { id: string; fullName: string; username: string };
type BankAccountOption = { id: string; bankName: string; accountAlias: string };
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

/**
 * Espejo puro de decomposeRetainedAmount (hammer-api/src/modules/treasury/decomposition.ts)
 * — sin paquete compartido entre hammer-api y hammer-frontend, se duplica a
 * mano con la misma firma (convención del repo). Solo para mostrar el
 * desglose EN VIVO mientras se teclea "Retener"; el backend vuelve a
 * calcularlo al guardar, esto no decide nada por sí solo.
 */
function decomposeRetainedAmount(retainAmount: number, cashFundAmount: number | null): { cashFundPortion: number; awaitingDepositPortion: number } {
  const fund = cashFundAmount ?? 0;
  const cashFundPortion = Math.round(Math.min(retainAmount, Math.max(0, fund)) * 100) / 100;
  const awaitingDepositPortion = Math.round((retainAmount - cashFundPortion) * 100) / 100;
  return { cashFundPortion, awaitingDepositPortion };
}

/**
 * correccion-destino-y-pantalla-cobro.md §1: los tres destinos son la
 * misma pregunta ("¿qué pasa con este efectivo antes de terminar el
 * día?"). No hay motivo que capturar — lo único obligatorio es quién lo
 * recibe cuando sale. Se abre justo después de cerrar la caja.
 */
export function CashDestinationDeclarationModal({
  cashSessionId, branchId, countedAmount, onClose, onSaved,
}: {
  cashSessionId: string;
  branchId: string;
  countedAmount: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [cashFundAmount, setCashFundAmount] = useState<number | null>(null);
  const [handOverAmount, setHandOverAmount] = useState("");
  const [handOverUserId, setHandOverUserId] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositCarrierUserId, setDepositCarrierUserId] = useState("");
  const [depositBankAccountId, setDepositBankAccountId] = useState("");
  const [retainAmount, setRetainAmount] = useState(countedAmount.toFixed(2));
  const [awaitingDepositLocation, setAwaitingDepositLocation] = useState<"DRAWER" | "SAFE">("DRAWER");
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
      if (peopleRaw) setPeople(unwrapApiData(peopleRaw) as Person[]);
      if (accountsRaw) setBankAccounts(unwrapApiData(accountsRaw) as BankAccountOption[]);
      if (branchesRaw) {
        const branches = unwrapApiData(branchesRaw) as Array<{ id: string; cashFundAmount: number | null }>;
        setCashFundAmount(branches.find((b) => b.id === branchId)?.cashFundAmount ?? null);
      }
      if (destinationRaw) {
        const summary = unwrapApiData(destinationRaw) as { postponements: Postponement[] };
        setPostponements(summary.postponements);
        const prefill = initialDeclarationFromPostponements(countedAmount, summary.postponements);
        if (summary.postponements.length > 0) setRetainAmount(prefill.retainAmount.toFixed(2));
      }
    }).catch(() => {});
    // countedAmount no debe re-disparar el fetch — solo se usa para el prefill
    // inicial, que corre una sola vez al abrir el modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, cashSessionId]);

  const handOver = Number(handOverAmount) || 0;
  const deposit = Number(depositAmount) || 0;
  const retain = Number(retainAmount) || 0;
  const total = Math.round((handOver + deposit + retain) * 100) / 100;
  const missing = Math.round((countedAmount - total) * 100) / 100;
  const exactMatch = Math.abs(missing) < 0.005;
  const retainSplit = decomposeRetainedAmount(retain, cashFundAmount);

  const needsHandOverPerson = handOver > 0 && !handOverUserId;
  const needsDepositCarrier = deposit > 0 && !depositCarrierUserId;
  // Cuenta destino obligatoria cuando hay entre cuáles elegir — mismo
  // criterio que el selector de cobro por transferencia: sin ninguna cuenta
  // cargada no se puede pedir un dato que no existe
  // (prompt-pantallas-recorrido-dinero.md §3).
  const needsDepositAccount = deposit > 0 && bankAccounts.length > 0 && !depositBankAccountId;
  const canConfirm = !saving && exactMatch && !needsHandOverPerson && !needsDepositCarrier && !needsDepositAccount;

  const postponedTotal = initialDeclarationFromPostponements(countedAmount, postponements).postponedTotal;
  const exceedsCounted = postponedTotal > countedAmount + 0.005;
  // Informativo, no bloquea: el cajero puede cambiar los montos a mano —
  // esto solo le avisa que está tocando algo que ya había declarado antes.
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
          awaitingDepositLocation,
        }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo registrar la declaración.");
      toast.success("Destino del efectivo registrado. ✓");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar la declaración.");
    } finally {
      setSaving(false);
    }
  }

  // Al tocar cualquier monto, "Retener" absorbe el resto automáticamente —
  // el caso más común (todo se queda en la sucursal) no exige tocar nada.
  function onHandOverChange(value: string) {
    setHandOverAmount(value);
    const nextRetain = Math.max(0, countedAmount - (Number(value) || 0) - deposit);
    setRetainAmount(nextRetain.toFixed(2));
  }
  function onDepositChange(value: string) {
    setDepositAmount(value);
    const nextRetain = Math.max(0, countedAmount - handOver - (Number(value) || 0));
    setRetainAmount(nextRetain.toFixed(2));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">¿Qué pasa con este efectivo?</h3>
            <p className="text-xs text-[var(--color-text-muted)]">Contado al cierre: C$ {countedAmount.toFixed(2)}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} icon={<X className="h-4 w-4" />}>Después</Button>
        </div>

        {postponements.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2.5 text-[13px] text-[var(--color-warning-700)]">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              {postponements.length === 1 ? (
                <span>
                  Ya declaraste que C$ {postponements[0].amount.toFixed(2)} se queda hasta el {fmtDate(postponements[0].postponedUntil)}
                  {postponements[0].reason ? ` — ${postponements[0].reason}` : ""}.
                </span>
              ) : (
                <>
                  <span>Ya declaraste C$ {postponedTotal.toFixed(2)} pospuestos en {postponements.length} veces durante esta sesión:</span>
                  <ul className="ml-4 list-disc space-y-0.5">
                    {postponements.map((p) => (
                      <li key={p.id}>
                        C$ {p.amount.toFixed(2)} hasta el {fmtDate(p.postponedUntil)}{p.reason ? ` — ${p.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {exceedsCounted && (
                <p className="font-semibold">Lo pospuesto (C$ {postponedTotal.toFixed(2)}) supera lo contado ahora (C$ {countedAmount.toFixed(2)}).</p>
              )}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="rounded-lg border border-[var(--color-border)] p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text)]">
              <HandCoins className="h-3.5 w-3.5" /> Entrega en persona
            </div>
            <div className="flex gap-2">
              <Input type="number" min="0" step="0.01" value={handOverAmount} onChange={(e) => onHandOverChange(e.target.value)} placeholder="0.00" className="w-28" />
              {handOver > 0 && (
                <select className="hm-input flex-1" value={handOverUserId} onChange={(e) => setHandOverUserId(e.target.value)}>
                  <option value="">¿Quién lo recibe?</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
                </select>
              )}
            </div>
            {needsHandOverPerson && <p className="mt-1 text-[0.65rem] text-[var(--color-danger-600)]">Falta quién recibe.</p>}
          </div>

          <div className="rounded-lg border border-[var(--color-border)] p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text)]">
              <Landmark className="h-3.5 w-3.5" /> Depositar
            </div>
            <div className="flex gap-2">
              <Input type="number" min="0" step="0.01" value={depositAmount} onChange={(e) => onDepositChange(e.target.value)} placeholder="0.00" className="w-28" />
              {deposit > 0 && (
                <select className="hm-input flex-1" value={depositCarrierUserId} onChange={(e) => setDepositCarrierUserId(e.target.value)}>
                  <option value="">¿Quién lo lleva?</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
                </select>
              )}
            </div>
            {deposit > 0 && bankAccounts.length > 0 && (
              <select className="hm-input mt-2 w-full" value={depositBankAccountId} onChange={(e) => setDepositBankAccountId(e.target.value)}>
                <option value="">Cuenta destino…</option>
                {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.bankName} · {a.accountAlias}</option>)}
              </select>
            )}
            {needsDepositCarrier && <p className="mt-1 text-[0.65rem] text-[var(--color-danger-600)]">Falta quién lo lleva.</p>}
            {needsDepositAccount && <p className="mt-1 text-[0.65rem] text-[var(--color-danger-600)]">Falta la cuenta destino.</p>}
          </div>

          <div className="rounded-lg border border-[var(--color-border)] p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text)]">
              <Vault className="h-3.5 w-3.5" /> Retener
            </div>
            <div className="flex gap-2">
              <Input type="number" min="0" step="0.01" value={retainAmount} onChange={(e) => setRetainAmount(e.target.value)} placeholder="0.00" className="w-28" />
              {retain > 0 && (
                <select className="hm-input flex-1" value={awaitingDepositLocation} onChange={(e) => setAwaitingDepositLocation(e.target.value as "DRAWER" | "SAFE")}>
                  <option value="DRAWER">En la gaveta</option>
                  <option value="SAFE">En la caja fuerte</option>
                </select>
              )}
            </div>
            {retain > 0 && (
              <div className="mt-2 space-y-0.5 border-t border-[var(--color-border)] pt-2 text-[0.6875rem] text-[var(--color-text-muted)]">
                <div className="flex justify-between">
                  <span>├─ Fondo de caja{cashFundAmount === null ? " (sin configurar)" : ""}</span>
                  <span className="tabular-nums">C$ {retainSplit.cashFundPortion.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-semibold text-[var(--color-text)]">
                  <span>└─ Esperando depósito</span>
                  <span className="tabular-nums">C$ {retainSplit.awaitingDepositPortion.toFixed(2)}</span>
                </div>
              </div>
            )}
            {belowPostponed && (
              <p className="mt-1.5 text-[0.65rem] text-[var(--color-warning-700)]">
                Esto es menos de lo que ya declaraste pospuesto (C$ {postponedTotal.toFixed(2)}) — estás cambiando lo que dijiste antes.
              </p>
            )}
          </div>
        </div>

        <div className={["flex items-center justify-between rounded-xl px-4 py-2.5 text-sm font-semibold",
          exactMatch ? "border border-[var(--color-success-200)] bg-[var(--color-success-50)] text-[var(--color-success-700)]" : "border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] text-[var(--color-danger-600)]"].join(" ")}>
          <span>Declarado C$ {total.toFixed(2)}</span>
          <span>{missing > 0 ? `Falta C$ ${missing.toFixed(2)}` : missing < 0 ? `Sobra C$ ${Math.abs(missing).toFixed(2)}` : "Exacto"}</span>
        </div>

        <Button variant="success" className="w-full" onClick={() => void submit()} disabled={!canConfirm} loading={saving} icon={<Check className="h-4 w-4" />}>
          Confirmar destino
        </Button>
      </div>
    </div>
  );
}
