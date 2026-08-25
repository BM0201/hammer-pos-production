"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HandCoins, Landmark, Moon, Lock, ChevronRight, ChevronDown, AlertTriangle, X, Check, Wallet } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";

/**
 * "Destino del efectivo" — un solo trabajo: decidir qué pasa con el
 * excedente de la gaveta. Entregar en persona y enviar al banco reusan
 * sendCashOutToCustody (mismo endpoint que la declaración de cierre);
 * posponer registra una decisión sin mover nada (postponeCashDeposit).
 * El usuario es un cajero con entrenamiento mínimo — todo lo que no sirve
 * a esa decisión se elimina de la pantalla.
 */

type CollectedThisSession = { cash: number; transfer: number; card: number; other: number; total: number };
type Movement = { id: string; type: "HANDOVER" | "DEPOSIT_DISPATCH"; amount: number; carrierName: string; bankName: string | null; occurredAt: string };
type Postponement = { id: string; amount: number; reason: string | null; postponedUntil: string; createdAt: string };
type CashDestinationSummary = {
  session: { id: string; openedAt: string; expectedCashAmount: number };
  collectedThisSession: CollectedThisSession;
  cashFundAmount: number;
  availableToMove: number;
  movements: Movement[];
  postponements: Postponement[];
  consecutivePostponements: number;
  policy: { maxDaysHolding: number } | null;
  requiresAttention: boolean;
};
type Person = { id: string; fullName: string; username: string };
type BankAccountOption = { id: string; bankName: string; accountAlias: string; accountNumber: string; currencyCode: "NIO" | "USD" };

const fmt = (v: number) => `C$${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("es-NI", { day: "2-digit", month: "short" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("es-NI", { hour: "2-digit", minute: "2-digit" });
const currencySymbol = (code: "NIO" | "USD") => (code === "USD" ? "$" : "C$");
/** El cajero reconoce la cuenta por el banco y los últimos dígitos, no por un alias interno. */
const maskAccountNumber = (accountNumber: string) => (accountNumber.length <= 4 ? accountNumber : `····${accountNumber.slice(-4)}`);

export default function CashDestinationPage() {
  const sessionState = useSession();
  const branchId = sessionState.status === "authenticated"
    ? getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId)
    : null;

  const [cashSessionId, setCashSessionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<CashDestinationSummary | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
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

      const [summaryRes, accountsRes] = await Promise.all([
        apiFetch(`/api/cashier/cash-sessions/${active.id}/cash-destination`),
        apiFetch(`/api/cashier/bank-accounts?branchId=${branchId}`),
      ]);
      const summaryRaw = await summaryRes.json();
      if (!summaryRes.ok) throw new Error(summaryRaw?.error?.message ?? "No se pudo cargar el destino del efectivo.");
      setSummary(unwrapApiData(summaryRaw) as CashDestinationSummary);

      const accountsRaw = await accountsRes.json().catch(() => null);
      if (accountsRes.ok && accountsRaw) setBankAccounts(unwrapApiData(accountsRaw) as BankAccountOption[]);
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

  const noCashAtAll = summary ? summary.collectedThisSession.cash <= 0.01 : false;
  const noSurplus = summary ? summary.availableToMove <= 0.01 : false;
  const noBankAccounts = bankAccounts.length === 0;
  const cashInDrawer = summary ? round2(summary.availableToMove + summary.cashFundAmount) : 0;
  const fundPct = summary && cashInDrawer > 0 ? Math.max(0, Math.min(100, (summary.cashFundAmount / cashInDrawer) * 100)) : 0;
  const movePct = 100 - fundPct;

  const history = summary
    ? [
        ...summary.movements.map((m) => ({ kind: "movement" as const, ...m, at: m.occurredAt })),
        ...summary.postponements.map((p) => ({ kind: "postponement" as const, ...p, at: p.createdAt })),
      ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    : [];

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-8 w-1 rounded-full" style={{ background: "var(--color-pay)" }} />
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text)]">Destino del efectivo</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Qué hacer con el excedente de la gaveta — sin esperar al cierre de caja.</p>
        </div>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Cargando…</p>
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
          {/* B.2 · El número primero — sin tarjeta que lo envuelva */}
          <div className="px-1">
            <p className="text-sm font-medium text-[var(--color-text-muted)]">Podés mover ahora</p>
            <p className="mt-1 text-[44px] font-medium leading-none tabular-nums text-[var(--color-success-700)]">{fmt(summary.availableToMove)}</p>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">de los {fmt(cashInDrawer)} que hay en la gaveta</p>

            {/* B.3 · La barra del fondo de caja — el elemento que más importa */}
            {summary.cashFundAmount > 0 && (
              <div className="mt-5">
                <div className="flex h-[52px] w-full overflow-hidden rounded-xl border border-[var(--color-border)]">
                  <div className="flex min-w-0 flex-col justify-center overflow-hidden bg-[var(--color-surface-alt)] px-3" style={{ width: `${fundPct}%` }}>
                    <span className="truncate text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Fondo de caja</span>
                    <span className="truncate text-xs font-bold tabular-nums text-[var(--color-text)]">{fmt(summary.cashFundAmount)}</span>
                  </div>
                  <div className="flex min-w-0 flex-col justify-center overflow-hidden bg-[var(--color-success-100)] px-3" style={{ width: `${movePct}%` }}>
                    <span className="truncate text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--color-success-700)]">Para mover</span>
                    <span className="truncate text-xs font-bold tabular-nums text-[var(--color-success-700)]">{fmt(summary.availableToMove)}</span>
                  </div>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--color-text-soft)]">
                  <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  El fondo de caja se queda en la gaveta para dar vuelto mañana
                </p>
              </div>
            )}
          </div>

          {/* B.4 · Tres filas — o el estado vacío que corresponda (B.7) */}
          <div>
            <h2 className="mb-2 px-1 text-[15px] font-medium text-[var(--color-text)]">
              {noSurplus ? "Nada para mover todavía" : `¿Qué hacés con los ${fmt(summary.availableToMove)}?`}
            </h2>
            {noSurplus ? (
              <p className="px-1 text-sm text-[var(--color-text-muted)]">
                {noCashAtAll
                  ? "Todavía no se ha cobrado efectivo en esta caja."
                  : `Todo el efectivo en gaveta es el fondo de caja (${fmt(summary.cashFundAmount)}). No hay excedente para mover.`}
              </p>
            ) : (
              <div className="space-y-2">
                <DecisionRow
                  icon={HandCoins}
                  title="Alguien lo recibe aquí mismo"
                  subtitle="Elegís quién lo recibe y el dinero queda a su nombre"
                  onClick={() => setActiveSheet("HANDOVER")}
                />
                <DecisionRow
                  icon={Landmark}
                  title="Alguien lo lleva al banco hoy"
                  subtitle="Elegís quién lo lleva y a qué cuenta va"
                  disabled={noBankAccounts}
                  disabledReason="No hay cuentas bancarias configuradas para esta sucursal. Pedile a Master que las cargue."
                  onClick={() => setActiveSheet("DISPATCH")}
                />
                <DecisionRow
                  icon={Moon}
                  title="Se queda en la gaveta hasta mañana"
                  subtitle="Queda anotado quién lo dejó y por qué"
                  onClick={() => setActiveSheet("POSTPONE")}
                />
              </div>
            )}
          </div>

          {/* B.6 · Historial al pie */}
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Movimientos de hoy</h2>
            {history.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">Todavía no se ha movido efectivo hoy.</p>
            ) : (
              <div className="space-y-1.5">
                {history.map((item) => (
                  <div
                    key={`${item.kind}-${item.id}`}
                    className={[
                      "flex items-center justify-between gap-3 rounded-lg border p-3 text-sm",
                      item.kind === "postponement" ? "border-[var(--color-warning-200)] bg-[var(--color-warning-50)]" : "border-[var(--color-border)]",
                    ].join(" ")}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {item.kind === "movement" ? (
                        item.type === "HANDOVER" ? <HandCoins className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" /> : <Landmark className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                      ) : (
                        <Moon className="h-4 w-4 shrink-0 text-[var(--color-warning-700)]" />
                      )}
                      <div className="min-w-0">
                        <p className={["truncate font-medium", item.kind === "postponement" ? "text-[var(--color-warning-700)]" : "text-[var(--color-text)]"].join(" ")}>
                          {item.kind === "movement"
                            ? item.type === "HANDOVER"
                              ? `Alguien lo recibe aquí mismo · ${item.carrierName}`
                              : `Alguien lo lleva al banco hoy · ${item.carrierName}${item.bankName ? ` · ${item.bankName}` : ""}`
                            : `Se queda en la gaveta hasta mañana${item.reason ? ` · ${item.reason}` : ""}`}
                        </p>
                        <p className={["text-xs", item.kind === "postponement" ? "text-[var(--color-warning-700)]/80" : "text-[var(--color-text-muted)]"].join(" ")}>
                          {fmtDate(item.at)} · {fmtTime(item.at)}
                        </p>
                      </div>
                    </div>
                    <span className={["shrink-0 font-mono font-bold tabular-nums", item.kind === "postponement" ? "text-[var(--color-warning-700)]" : "text-[var(--color-text)]"].join(" ")}>
                      {fmt(item.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* B.1 · Tarjeta y transferencia — nota al pie, no la casilla que ocupaba un tercio de la pantalla */}
          {(summary.collectedThisSession.card > 0.01 || summary.collectedThisSession.transfer > 0.01) && (
            <p className="px-1 text-center text-xs text-[var(--color-text-soft)]">
              Cobrado con tarjeta y transferencia: {fmt(summary.collectedThisSession.card + summary.collectedThisSession.transfer)} — ese dinero va solo al banco, no pasa por la gaveta.
            </p>
          )}

          {activeSheet === "HANDOVER" && (
            <SendCashSheet
              mode="HANDOVER"
              branchId={branchId}
              cashSessionId={cashSessionId}
              availableToMove={summary.availableToMove}
              bankAccounts={bankAccounts}
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
              bankAccounts={bankAccounts}
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

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

function DecisionRow({ icon: Icon, title, subtitle, disabled, disabledReason, onClick }: {
  icon: typeof HandCoins;
  title: string;
  subtitle: string;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className="flex min-h-[64px] w-full items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left transition-colors hover:border-[var(--color-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-pay)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Icon className="h-6 w-6 shrink-0 text-[var(--color-pay)]" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-[var(--color-text)]">{title}</span>
        <span className="block text-[13px] text-[var(--color-text-muted)]">{disabled && disabledReason ? disabledReason : subtitle}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-text-soft)]" aria-hidden="true" />
    </button>
  );
}

/** Selector de cuenta en dos líneas — el cajero reconoce por banco + últimos dígitos, no por alias interno (B.5). */
function BankAccountPicker({ accounts, value, onChange }: { accounts: BankAccountOption[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => { if (!containerRef.current?.contains(e.target as Node)) setOpen(false); };
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const selected = accounts.find((a) => a.id === value) ?? null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-pay)]"
      >
        {selected ? (
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-[var(--color-text)]">{selected.bankName}</span>
            <span className="block truncate text-xs text-[var(--color-text-muted)]">
              {selected.accountAlias} · {maskAccountNumber(selected.accountNumber)} · {currencySymbol(selected.currencyCode)}
            </span>
          </span>
        ) : (
          <span className="text-sm text-[var(--color-text-soft)]">Selecciona una cuenta…</span>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-text-soft)]" aria-hidden="true" />
      </button>
      {open && (
        <div role="listbox" className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              role="option"
              aria-selected={a.id === value}
              onClick={() => { onChange(a.id); setOpen(false); }}
              className={[
                "block w-full px-3 py-2 text-left hover:bg-[var(--color-surface-alt)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-pay)]",
                a.id === value ? "bg-[var(--color-surface-alt)]" : "",
              ].join(" ")}
            >
              <span className="block text-sm font-semibold text-[var(--color-text)]">{a.bankName}</span>
              <span className="block text-xs text-[var(--color-text-muted)]">
                {a.accountAlias} · {maskAccountNumber(a.accountNumber)} · {currencySymbol(a.currencyCode)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "Alguien lo recibe aquí mismo" / "Alguien lo lleva al banco hoy" — ambas
 * reusan sendCashOutToCustody (POST send-deposit), solo cambia `reason` y,
 * en DISPATCH, la cuenta destino ahora sí se persiste (intendedBankAccountId).
 */
function SendCashSheet({ mode, branchId, cashSessionId, availableToMove, bankAccounts, onClose, onDone }: {
  mode: "HANDOVER" | "DISPATCH";
  branchId: string;
  cashSessionId: string;
  availableToMove: number;
  bankAccounts: BankAccountOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [amount, setAmount] = useState(availableToMove > 0 ? availableToMove.toFixed(2) : "");
  const [carrierUserId, setCarrierUserId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    apiFetch(`/api/branches/${branchId}/members`).then((r) => (r.ok ? r.json() : null))
      .then((raw) => { if (raw) setPeople(unwrapApiData(raw) as Person[]); })
      .catch(() => {});
    setTimeout(() => firstFieldRef.current?.focus(), 50);
  }, [branchId]);

  // Si hay una sola cuenta, preseleccionala pero dejá el campo visible (B.5).
  useEffect(() => {
    if (mode === "DISPATCH" && bankAccounts.length === 1) setBankAccountId(bankAccounts[0].id);
  }, [mode, bankAccounts]);

  const amountNumber = Number(amount) || 0;
  const overCap = amountNumber > availableToMove + 0.01;
  const title = mode === "HANDOVER" ? "Alguien lo recibe aquí mismo" : "Alguien lo lleva al banco hoy";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return; // mueve dinero real — el doble toque no puede duplicarlo.
    if (!carrierUserId) { toast.error(mode === "HANDOVER" ? "Elegí quién lo recibe." : "Elegí quién lo lleva."); return; }
    if (mode === "DISPATCH" && !bankAccountId) { toast.error("Elegí a qué cuenta va."); return; }
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
          bankAccountId: mode === "DISPATCH" ? bankAccountId : undefined,
        }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo registrar el envío.");
      toast.success(`${fmt(amountNumber)} — ${title}.`);
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
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={submitting} icon={<X className="h-4 w-4" />}>Cerrar</Button>
        </div>

        <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
          Monto
          <div className="mt-1 flex gap-2">
            <Input ref={firstFieldRef} type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={overCap ? "border-[var(--color-danger-400)]" : ""} required />
            <Button type="button" variant="ghost" size="sm" onClick={() => setAmount(availableToMove.toFixed(2))}>Todo</Button>
          </div>
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
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">¿A qué cuenta va?</label>
            <BankAccountPicker accounts={bankAccounts} value={bankAccountId} onChange={setBankAccountId} />
          </div>
        )}

        <Button type="submit" variant="success" loading={submitting} disabled={overCap} className="w-full" icon={<Check className="h-4 w-4" />}>
          {mode === "HANDOVER" ? "Confirmar entrega" : "Confirmar envío"}
        </Button>
      </form>
    </div>
  );
}

/** "Se queda en la gaveta hasta mañana" — postponeCashDeposit: registra la decisión, NO mueve dinero. */
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
    if (submitting) return; // registra un compromiso real — el doble toque no puede duplicarlo.
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
      const data = unwrapApiData(raw) as { postponement: { postponedUntil: string } };
      toast.success(`Se queda en la gaveta hasta el ${fmtDate(data.postponement.postponedUntil)}.`);
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
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Se queda en la gaveta hasta mañana</h3>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={submitting} icon={<X className="h-4 w-4" />}>Cerrar</Button>
        </div>

        <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
          Monto
          <div className="mt-1 flex gap-2">
            <Input ref={firstFieldRef} type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={overCap ? "border-[var(--color-danger-400)]" : ""} required />
            <Button type="button" variant="ghost" size="sm" onClick={() => setAmount(availableToMove.toFixed(2))}>Todo</Button>
          </div>
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

        <Button type="submit" variant="secondary" loading={submitting} disabled={overCap} className="w-full" icon={<Moon className="h-4 w-4" />}>
          Confirmar
        </Button>
      </form>
    </div>
  );
}
