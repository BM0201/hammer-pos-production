"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HandCoins, Landmark, Clock, AlertTriangle, X, Check, Wallet, ArrowLeftRight } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";

/**
 * "Destino del efectivo" — conecta la caja con Tesorería sin esperar al
 * cierre. Tres acciones sobre lo que ya hay en la gaveta: entregar en
 * persona, enviar a depositar (ambas via sendCashOutToCustody, mismo
 * endpoint que ya usa la declaración de cierre), o posponer hasta mañana
 * (registra la decisión, no mueve nada — postponeCashDeposit).
 */

type CollectedToday = { cash: number; transfer: number; card: number; other: number; total: number };
type Movement = { id: string; type: "HANDOVER" | "DEPOSIT_DISPATCH"; amount: number; carrierName: string; occurredAt: string };
type Postponement = { id: string; amount: number; reason: string | null; postponedUntil: string; createdAt: string };
type CashDestinationSummary = {
  session: { id: string; openedAt: string; expectedCashAmount: number };
  collectedToday: CollectedToday;
  availableToMove: number;
  movements: Movement[];
  postponements: Postponement[];
  consecutivePostponements: number;
  policy: { maxDaysHolding: number } | null;
  requiresAttention: boolean;
};
type Person = { id: string; fullName: string; username: string };
type BankAccountOption = { id: string; bankName: string; accountAlias: string };

const fmt = (v: number) => `C$${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("es-NI", { day: "2-digit", month: "short" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("es-NI", { hour: "2-digit", minute: "2-digit" });

export default function CashDestinationPage() {
  const sessionState = useSession();
  const branchId = sessionState.status === "authenticated"
    ? getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId)
    : null;

  const [cashSessionId, setCashSessionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<CashDestinationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSheet, setActiveSheet] = useState<null | "HANDOVER" | "DISPATCH" | "POSTPONE">(null);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const activeRes = await apiFetch(`/api/cashier/cash-sessions/active?branchId=${branchId}`);
      const activeRaw = await activeRes.json();
      if (!activeRes.ok) throw new Error(activeRaw?.error?.message ?? "No se pudo verificar la caja.");
      const active = unwrapApiData(activeRaw) as { id: string; status: string } | null;

      if (!active || active.status !== "OPEN") {
        setCashSessionId(null);
        setSummary(null);
        return;
      }
      setCashSessionId(active.id);

      const res = await apiFetch(`/api/cashier/cash-sessions/${active.id}/cash-destination`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar el destino del efectivo.");
      setSummary(unwrapApiData(raw) as CashDestinationSummary);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar el destino del efectivo.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { void load(); }, [load]);

  if (sessionState.status === "loading" || (!branchId && sessionState.status === "authenticated")) {
    return <p className="text-[var(--color-text-muted)] animate-pulse">Cargando…</p>;
  }
  if (sessionState.status !== "authenticated" || !branchId) {
    return <p className="text-[var(--color-danger-600)]">No tienes una sucursal asignada.</p>;
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-8 w-1 rounded-full" style={{ background: "var(--color-pay)" }} />
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text)]">Destino del efectivo</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Qué hacer con lo cobrado hoy — sin esperar al cierre de caja.</p>
        </div>
      </div>

      {loading ? (
        <Card className="p-4">
          <p className="py-8 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Cargando…</p>
        </Card>
      ) : !cashSessionId || !summary ? (
        <Card className="p-4">
          <div className="py-8 text-center">
            <Wallet className="mx-auto mb-2 h-6 w-6 text-[var(--color-text-soft)]" aria-hidden="true" />
            <p className="text-sm font-semibold text-[var(--color-text)]">No hay caja abierta</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Este módulo depende de una sesión de caja abierta.</p>
            <Link href="/app/branch/cash" className="mt-3 inline-block text-xs font-semibold text-[var(--color-pay)] hover:underline">
              Ir a Caja
            </Link>
          </div>
        </Card>
      ) : (
        <>
          {/* BLOQUE 1 · Lo cobrado hoy */}
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Lo cobrado hoy</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MethodTile label="Efectivo" value={summary.collectedToday.cash} />
              <MethodTile label="Tarjeta" value={summary.collectedToday.card} />
              <MethodTile label="Transferencia" value={summary.collectedToday.transfer} />
              <MethodTile label="Otros" value={summary.collectedToday.other} />
            </div>
            <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Disponible para mover</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--color-text)]">{fmt(summary.availableToMove)}</p>
              <p className="mt-1 text-xs text-[var(--color-text-soft)]">solo efectivo — tarjeta y transferencia ya están en Tesorería</p>
            </div>
          </Card>

          {/* BLOQUE 2 · Qué hacer con el efectivo */}
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Qué hacer con el efectivo</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              <ActionCard
                icon={HandCoins}
                label="Entregar en persona"
                description="A alguien que lo recibe ahora mismo"
                disabled={summary.availableToMove <= 0.01}
                onClick={() => setActiveSheet("HANDOVER")}
              />
              <ActionCard
                icon={Landmark}
                label="Enviar a depositar"
                description="Sale hacia el banco con un portador"
                disabled={summary.availableToMove <= 0.01}
                onClick={() => setActiveSheet("DISPATCH")}
              />
              <ActionCard
                icon={Clock}
                label="Dejar en caja hasta mañana"
                description="Se queda en la gaveta, registrado"
                disabled={summary.availableToMove <= 0.01}
                onClick={() => setActiveSheet("POSTPONE")}
              />
            </div>
            {summary.availableToMove <= 0.01 && (
              <p className="mt-2 text-xs text-[var(--color-text-soft)]">No hay efectivo disponible para mover todavía.</p>
            )}
          </Card>

          {/* BLOQUE 3 · Movimientos de hoy */}
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Movimientos de hoy</h2>
            {summary.movements.length === 0 && summary.postponements.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">El efectivo del día sigue completo en caja.</p>
            ) : (
              <div className="space-y-1.5">
                {summary.movements.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] p-3 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      {m.type === "HANDOVER" ? <HandCoins className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" /> : <Landmark className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />}
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[var(--color-text)]">
                          {m.type === "HANDOVER" ? "Entregado en persona" : "Enviado a depositar"} · {m.carrierName}
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)]">{fmtDate(m.occurredAt)} · {fmtTime(m.occurredAt)}</p>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono font-bold tabular-nums text-[var(--color-text)]">{fmt(m.amount)}</span>
                  </div>
                ))}
                {summary.postponements.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <Clock className="h-4 w-4 shrink-0 text-[var(--color-warning-700)]" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[var(--color-warning-700)]">
                          Pospuesto hasta el {fmtDate(p.postponedUntil)}{p.reason ? ` · ${p.reason}` : ""}
                        </p>
                        <p className="text-xs text-[var(--color-warning-700)]/80">{fmtDate(p.createdAt)} · {fmtTime(p.createdAt)}</p>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono font-bold tabular-nums text-[var(--color-warning-700)]">{fmt(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {activeSheet === "HANDOVER" && (
            <SendCashSheet
              mode="HANDOVER"
              branchId={branchId}
              cashSessionId={cashSessionId}
              availableToMove={summary.availableToMove}
              onClose={() => setActiveSheet(null)}
              onDone={() => { setActiveSheet(null); void load(); }}
            />
          )}
          {activeSheet === "DISPATCH" && (
            <SendCashSheet
              mode="DISPATCH"
              branchId={branchId}
              cashSessionId={cashSessionId}
              availableToMove={summary.availableToMove}
              onClose={() => setActiveSheet(null)}
              onDone={() => { setActiveSheet(null); void load(); }}
            />
          )}
          {activeSheet === "POSTPONE" && (
            <PostponeSheet
              cashSessionId={cashSessionId}
              availableToMove={summary.availableToMove}
              consecutivePostponements={summary.consecutivePostponements}
              policy={summary.policy}
              onClose={() => setActiveSheet(null)}
              onDone={() => { setActiveSheet(null); void load(); }}
            />
          )}
        </>
      )}
    </section>
  );
}

function MethodTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
      <div className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div>
      <p className="mt-1 text-lg font-bold tabular-nums text-[var(--color-text)]">{fmt(value)}</p>
    </div>
  );
}

function ActionCard({ icon: Icon, label, description, disabled, onClick }: {
  icon: typeof HandCoins;
  label: string;
  description: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Nada disponible para mover" : undefined}
      className="flex flex-col items-start gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left transition-colors hover:border-[var(--color-border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Icon className="h-5 w-5 text-[var(--color-pay)]" aria-hidden="true" />
      <span className="text-sm font-semibold text-[var(--color-text)]">{label}</span>
      <span className="text-xs text-[var(--color-text-muted)]">{description}</span>
    </button>
  );
}

/**
 * Entregar en persona / Enviar a depositar — ambas reusan sendCashOutToCustody
 * (POST send-deposit), solo cambia `reason`. La cuenta destino en modo
 * DISPATCH es informativa (a qué banco se dirige el portador): send-deposit
 * no tiene un campo para persistirla — quién confirma a cuál cuenta llegó,
 * lo resuelve Master después desde Tesorería (confirmBankDeposit).
 */
function SendCashSheet({ mode, branchId, cashSessionId, availableToMove, onClose, onDone }: {
  mode: "HANDOVER" | "DISPATCH";
  branchId: string;
  cashSessionId: string;
  availableToMove: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [amount, setAmount] = useState(availableToMove > 0 ? availableToMove.toFixed(2) : "");
  const [carrierUserId, setCarrierUserId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const requests = [apiFetch(`/api/branches/${branchId}/members`).then((r) => (r.ok ? r.json() : null))];
    if (mode === "DISPATCH") requests.push(apiFetch(`/api/master/treasury/bank-accounts?branchId=${branchId}`).then((r) => (r.ok ? r.json() : null)));
    Promise.all(requests).then(([peopleRaw, accountsRaw]) => {
      if (peopleRaw) setPeople(unwrapApiData(peopleRaw) as Person[]);
      if (accountsRaw) setBankAccounts(unwrapApiData(accountsRaw) as BankAccountOption[]);
    }).catch(() => {});
    setTimeout(() => firstFieldRef.current?.focus(), 50);
  }, [branchId, mode]);

  const amountNumber = Number(amount) || 0;
  const overCap = amountNumber > availableToMove + 0.01;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return; // mueve dinero real — el doble click no puede duplicarlo.
    if (!carrierUserId) { toast.error(mode === "HANDOVER" ? "Elegí quién lo recibe." : "Elegí quién lo lleva."); return; }
    if (amountNumber <= 0) { toast.error("El monto debe ser mayor que 0."); return; }
    if (overCap) { toast.error(`El monto no puede superar lo disponible (${fmt(availableToMove)}).`); return; }

    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/cashier/cash-sessions/${cashSessionId}/send-deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cashSessionId,
          amount: amountNumber,
          carrierUserId,
          reason: mode === "HANDOVER" ? "HANDOVER" : "DEPOSIT_DISPATCH",
        }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo registrar el envío.");
      toast.success(`${fmt(amountNumber)} ${mode === "HANDOVER" ? "entregado" : "enviado a depositar"}.`);
      onDone();
    } catch (error) {
      // Error → el sheet queda ABIERTO con los datos intactos.
      toast.error(error instanceof Error ? error.message : "No se pudo registrar el envío.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{mode === "HANDOVER" ? "Entregar en persona" : "Enviar a depositar"}</h3>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={submitting} icon={<X className="h-4 w-4" />}>Cerrar</Button>
        </div>

        <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
          Monto
          <Input ref={firstFieldRef} type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={`mt-1 ${overCap ? "border-[var(--color-danger-400)]" : ""}`} required />
          <span className={["mt-1 block text-[0.6875rem]", overCap ? "font-semibold text-[var(--color-danger-600)]" : "text-[var(--color-text-soft)]"].join(" ")}>
            Disponible: {fmt(availableToMove)}
          </span>
        </label>

        <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
          {mode === "HANDOVER" ? "¿Quién lo recibe?" : "¿Quién lo lleva?"}
          <select className="hm-input mt-1 w-full" value={carrierUserId} onChange={(e) => setCarrierUserId(e.target.value)} required>
            <option value="">Selecciona una persona…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
        </label>

        {mode === "DISPATCH" && (
          <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
            Cuenta destino (referencia)
            <select className="hm-input mt-1 w-full" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              <option value="">Sin especificar…</option>
              {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.bankName} · {a.accountAlias}</option>)}
            </select>
            <span className="mt-1 block text-[0.6875rem] text-[var(--color-text-soft)]">Solo para que el portador sepa a dónde va — Master confirma el depósito real después.</span>
          </label>
        )}

        <Button type="submit" variant="success" loading={submitting} disabled={overCap} className="w-full" icon={<Check className="h-4 w-4" />}>
          {mode === "HANDOVER" ? "Confirmar entrega" : "Confirmar envío"}
        </Button>
      </form>
    </div>
  );
}

/** "Dejar en caja hasta mañana" — postponeCashDeposit: registra la decisión, NO mueve dinero. */
function PostponeSheet({ cashSessionId, availableToMove, consecutivePostponements, policy, onClose, onDone }: {
  cashSessionId: string;
  availableToMove: number;
  consecutivePostponements: number;
  policy: { maxDaysHolding: number } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(availableToMove > 0 ? availableToMove.toFixed(2) : "");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { setTimeout(() => firstFieldRef.current?.focus(), 50); }, []);

  const amountNumber = Number(amount) || 0;
  const overCap = amountNumber > availableToMove + 0.01;
  const nextConsecutiveCount = consecutivePostponements + 1;
  const willRequireAttention = policy !== null && nextConsecutiveCount >= policy.maxDaysHolding;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return; // registra un compromiso real — el doble click no puede duplicarlo.
    if (amountNumber <= 0) { toast.error("El monto debe ser mayor que 0."); return; }
    if (overCap) { toast.error(`El monto no puede superar el efectivo esperado en caja (${fmt(availableToMove)}).`); return; }

    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/cashier/cash-sessions/${cashSessionId}/postpone-deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashSessionId, amount: amountNumber, reason: reason.trim() || undefined }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo registrar la posposición.");
      const postponedUntil = unwrapApiData(raw) as { postponement: { postponedUntil: string } };
      toast.success(`Registrado. Queda pendiente hasta el ${fmtDate(postponedUntil.postponement.postponedUntil)}.`);
      onDone();
    } catch (error) {
      // Error → el sheet queda ABIERTO con los datos intactos.
      toast.error(error instanceof Error ? error.message : "No se pudo registrar la posposición.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Dejar en caja hasta mañana</h3>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={submitting} icon={<X className="h-4 w-4" />}>Cerrar</Button>
        </div>

        <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
          Monto
          <Input ref={firstFieldRef} type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={`mt-1 ${overCap ? "border-[var(--color-danger-400)]" : ""}`} required />
          <span className={["mt-1 block text-[0.6875rem]", overCap ? "font-semibold text-[var(--color-danger-600)]" : "text-[var(--color-text-soft)]"].join(" ")}>
            Disponible: {fmt(availableToMove)}
          </span>
        </label>

        <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
          Motivo (opcional)
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sin transporte disponible hoy" className="mt-1" />
        </label>

        {/* El cajero tiene que saber a qué se compromete ANTES de confirmar. */}
        <p className="rounded-lg bg-[var(--color-surface-alt)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
          Queda registrado hasta el <strong className="text-[var(--color-text)]">próximo día hábil</strong>.
        </p>

        {willRequireAttention && (
          <p className="flex items-start gap-1.5 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Este efectivo lleva {nextConsecutiveCount} posposiciones seguidas. Master lo ve en Tesorería.</span>
          </p>
        )}

        <Button type="submit" variant="secondary" loading={submitting} disabled={overCap} className="w-full" icon={<ArrowLeftRight className="h-4 w-4" />}>
          Confirmar posposición
        </Button>
      </form>
    </div>
  );
}
