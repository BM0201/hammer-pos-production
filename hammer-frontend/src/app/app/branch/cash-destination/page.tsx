"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HandCoins, Landmark, Moon, Lock, Clock, UserCheck, Users, Footprints, ChevronRight, ChevronDown, AlertTriangle, X, Check, Wallet } from "lucide-react";
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

/** SELF_TO_BANK/OTHER_TO_BANK y HANDOVER_HERE/SELF_TO_PERSON son el mismo `reason` (DEPOSIT_DISPATCH/HANDOVER) — la variante sale de si carrierUserId === session.userId, no de un cuarto campo paralelo. */
type SheetKind = "SELF_TO_BANK" | "OTHER_TO_BANK" | "HANDOVER_HERE" | "SELF_TO_PERSON" | "POSTPONE";
type Movement = {
  id: string;
  type: "HANDOVER" | "DEPOSIT_DISPATCH";
  amount: number;
  carrierUserId: string;
  carrierName: string;
  bankName: string | null;
  bankLast4: string | null;
  intendedRecipientUserId: string | null;
  intendedRecipientName: string | null;
  occurredAt: string;
};
type Postponement = { id: string; amount: number; reason: string | null; postponedUntil: string; createdAt: string };
type BankAccountBreakdown = { accountId: string; bankName: string; accountAlias: string; last4: string; amount: number };
type CashDestinationSummary = {
  session: { id: string; openedAt: string; expectedCashAmount: number };
  /** Parte C — los tres estados del dinero, mismo vocabulario que Tesorería de Master. */
  money: {
    physical: { inDrawer: number; cashFund: number; availableToMove: number };
    inAccount: { total: number; byAccount: BankAccountBreakdown[] };
    pendingSettlement: { total: number };
    other: { total: number };
  };
  movements: Movement[];
  postponements: Postponement[];
  consecutivePostponements: number;
  policy: { maxDaysHolding: number } | null;
  requiresAttention: boolean;
};
/** roleLabel viene ya resuelto del backend (rol de sucursal si lo tiene, si no el globalRole) — el cajero necesita saber QUIÉN es "Elena Bermúdez", no solo su nombre (§A.4). */
type BranchPerson = { id: string; fullName: string; roleLabel: string };
type BankAccountOption = { id: string; bankName: string; accountAlias: string; accountNumber: string; currencyCode: "NIO" | "USD" };

const fmt = (v: number) => `C$${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("es-NI", { day: "2-digit", month: "short" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("es-NI", { hour: "2-digit", minute: "2-digit" });
const currencySymbol = (code: "NIO" | "USD") => (code === "USD" ? "$" : "C$");
/** El cajero reconoce la cuenta por el banco y los últimos dígitos, no por un alias interno. */
const maskAccountNumber = (accountNumber: string) => (accountNumber.length <= 4 ? accountNumber : `····${accountNumber.slice(-4)}`);

/** Título del sheet = título exacto de la fila que lo abrió (D.1) — dos textos distintos para la misma operación confunden a quien está aprendiendo. */
const SHEET_TITLES: Record<Exclude<SheetKind, "POSTPONE">, string> = {
  SELF_TO_BANK: "Yo lo llevo al banco",
  OTHER_TO_BANK: "Otra persona lo lleva al banco",
  HANDOVER_HERE: "Se lo entrego a alguien aquí mismo",
  SELF_TO_PERSON: "Yo se lo llevo a alguien",
};

/** Las cuatro variantes del historial (D.5): mismo `reason`, se distinguen por si el portador es el usuario de sesión. */
function describeMovement(m: Movement, selfUserId: string): string {
  const isSelfCarry = m.carrierUserId === selfUserId;
  if (m.type === "DEPOSIT_DISPATCH") {
    const bank = m.bankName ? `${m.bankName}${m.bankLast4 ? ` ****${m.bankLast4}` : ""}` : "el banco";
    return isSelfCarry ? `Lo llevaste vos a ${bank}` : `${m.carrierName} lo llevó a ${bank}`;
  }
  if (isSelfCarry) {
    return m.intendedRecipientName ? `Lo llevás vos para entregar a ${m.intendedRecipientName}` : "Lo llevás vos para entregar";
  }
  return `Entregado a ${m.carrierName}`;
}

export default function CashDestinationPage() {
  const sessionState = useSession();
  const branchId = sessionState.status === "authenticated"
    ? getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId)
    : null;

  const [cashSessionId, setCashSessionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<CashDestinationSummary | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSheet, setActiveSheet] = useState<SheetKind | null>(null);
  const [selfFullName, setSelfFullName] = useState("");

  const selfUserId = sessionState.status === "authenticated" ? sessionState.session.userId : "";

  // fullName no viaja en el JWT de sesión (solo username) — se resuelve una
  // vez contra /api/auth/session, mismo patrón que idle-lock.tsx, para poder
  // mostrar "Lo llevás vos: {nombre}" (D.2) en vez de un username interno.
  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/auth/session", { suppressAuthRedirect: true })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        const data = unwrapApiData(raw) as { user?: { fullName?: string | null; username?: string } } | null;
        if (data?.user) setSelfFullName(data.user.fullName || data.user.username || "");
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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

  const noCashAtAll = summary ? summary.money.physical.inDrawer <= 0.01 : false;
  const noSurplus = summary ? summary.money.physical.availableToMove <= 0.01 : false;
  const noBankAccounts = bankAccounts.length === 0;
  const cashInDrawer = summary ? summary.money.physical.inDrawer : 0;
  const fundPct = summary && cashInDrawer > 0 ? Math.max(0, Math.min(100, (summary.money.physical.cashFund / cashInDrawer) * 100)) : 0;

  // C.4 — el cajero necesita saber qué pasó ANTES de decidir qué hacer
  // ahora; hoy eso solo aparecía en el historial, después de las opciones.
  // Los movimientos ya vienen orderBy occurredAt asc, así que el primero es
  // el más viejo — el que más tiempo lleva sin confirmar.
  const oldestPendingMovement = summary?.movements[0] ?? null;
  const oldestPendingPostponement = summary?.postponements[0] ?? null;
  const pendingNotice = oldestPendingMovement
    ? `En tránsito desde ${fmtDate(oldestPendingMovement.occurredAt)}: ${fmt(oldestPendingMovement.amount)} con ${oldestPendingMovement.carrierName}, sin confirmar`
    : oldestPendingPostponement
    ? `Pospuesto desde ${fmtDate(oldestPendingPostponement.createdAt)}: ${fmt(oldestPendingPostponement.amount)}, sin llevar`
    : null;

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
            <p className="mt-1 text-[44px] font-medium leading-none tabular-nums text-[var(--color-success-700)]">{fmt(summary.money.physical.availableToMove)}</p>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">de los {fmt(cashInDrawer)} que hay en la gaveta</p>

            {/* B.3 · La barra del fondo de caja — solo proporción, sin texto adentro (Parte B: al 3.7% de ancho el texto se truncaba en "FO... C...") */}
            {summary.money.physical.cashFund > 0 && (
              <div className="mt-5">
                <div className="flex h-[14px] w-full overflow-hidden rounded-[7px]">
                  <div className="h-full shrink-0 bg-[var(--color-surface-alt)]" style={{ width: `${fundPct}%`, minWidth: "6px" }} />
                  <div className="h-full min-w-0 flex-1 bg-[var(--color-success-500)]" />
                </div>

                {/* La cifra vive arriba, una sola vez (hero) — acá solo la leyenda que explica la proporción */}
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px]">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-sm bg-[var(--color-surface-alt)]" aria-hidden="true" />
                    <span className="text-[var(--color-text-muted)]">Fondo de caja</span>
                    <span className="font-medium tabular-nums text-[var(--color-text)]">{fmt(summary.money.physical.cashFund)}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-sm bg-[var(--color-success-500)]" aria-hidden="true" />
                    <span className="text-[var(--color-text-muted)]">Para mover</span>
                    <span className="font-medium tabular-nums text-[var(--color-text)]">{fmt(summary.money.physical.availableToMove)}</span>
                  </span>
                </div>

                <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--color-text-soft)]">
                  <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  El fondo de caja se queda en la gaveta para dar vuelto mañana
                </p>
              </div>
            )}
          </div>

          {/* B.4 · Cinco filas en tres grupos — o el estado vacío que corresponda (B.7) */}
          <div>
            <h2 className="px-1 text-[15px] font-medium text-[var(--color-text)]">
              {noSurplus ? "Nada para mover todavía" : `¿Qué hacés con los ${fmt(summary.money.physical.availableToMove)}?`}
            </h2>

            {/* C.4 — qué pasó ANTES de decidir qué hacer ahora */}
            {pendingNotice && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2.5 text-[13px] text-[var(--color-warning-700)]">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{pendingNotice}</span>
              </div>
            )}

            {noSurplus ? (
              <p className="mt-2 px-1 text-sm text-[var(--color-text-muted)]">
                {noCashAtAll
                  ? "Todavía no se ha cobrado efectivo en esta caja."
                  : `Todo el efectivo en gaveta es el fondo de caja (${fmt(summary.money.physical.cashFund)}). No hay excedente para mover.`}
              </p>
            ) : (
              <div className="mt-3 space-y-4">
                <div>
                  <p className="mb-2 px-1 text-[13px] text-[var(--color-text-muted)]">Va al banco</p>
                  <div className="space-y-2">
                    <DecisionRow
                      icon={UserCheck}
                      title="Yo lo llevo al banco"
                      subtitle="Solo elegís el monto y la cuenta"
                      disabled={noBankAccounts}
                      disabledReason="No hay cuentas bancarias configuradas para esta sucursal. Pedile a Master que las cargue."
                      onClick={() => setActiveSheet("SELF_TO_BANK")}
                    />
                    <DecisionRow
                      icon={Users}
                      title="Otra persona lo lleva al banco"
                      subtitle="Elegís quién lo lleva y a qué cuenta va"
                      disabled={noBankAccounts}
                      disabledReason="No hay cuentas bancarias configuradas para esta sucursal. Pedile a Master que las cargue."
                      onClick={() => setActiveSheet("OTHER_TO_BANK")}
                    />
                  </div>
                </div>

                <div>
                  <p className="mb-2 px-1 text-[13px] text-[var(--color-text-muted)]">Va con una persona</p>
                  <div className="space-y-2">
                    <DecisionRow
                      icon={HandCoins}
                      title="Se lo entrego a alguien aquí mismo"
                      subtitle="La persona está acá y lo recibe ahora"
                      onClick={() => setActiveSheet("HANDOVER_HERE")}
                    />
                    <DecisionRow
                      icon={Footprints}
                      title="Yo se lo llevo a alguien"
                      subtitle="Elegís a quién. Queda a tu nombre hasta que lo reciba"
                      onClick={() => setActiveSheet("SELF_TO_PERSON")}
                    />
                  </div>
                </div>

                <div>
                  <p className="mb-2 px-1 text-[13px] text-[var(--color-text-muted)]">No sale hoy</p>
                  <div className="space-y-2">
                    <DecisionRow
                      icon={Moon}
                      title="Se queda en la gaveta hasta mañana"
                      subtitle="Queda anotado quién lo dejó y por qué"
                      onClick={() => setActiveSheet("POSTPONE")}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Parte D · Sección 2 — dinero que no pasa por la gaveta: ya está
              registrado, no es una decisión. Filas planas, sin borde de
              tarjeta ni chevron — esto no se toca. */}
          {(summary.money.inAccount.total > 0.01 || summary.money.pendingSettlement.total > 0.01) && (
            <div className="space-y-4 border-t border-[var(--color-border)] px-1 pt-5">
              <div>
                <h2 className="text-[15px] font-medium text-[var(--color-text)]">Dinero que no pasa por la gaveta</h2>
                <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">Esto ya está registrado. No tenés que hacer nada.</p>
              </div>

              {summary.money.inAccount.total > 0.01 && (
                <div className="flex items-start gap-3">
                  <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-soft)]" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-[var(--color-text-muted)]">En cuenta</span>
                      <span className="text-[20px] font-medium leading-none tabular-nums text-[var(--color-text-muted)]">{fmt(summary.money.inAccount.total)}</span>
                    </div>
                    <div className="mt-1.5 space-y-0.5">
                      {summary.money.inAccount.byAccount.slice(0, 3).map((a) => (
                        <p key={a.accountId} className="text-[13px] text-[var(--color-text-soft)]">
                          Banco {a.bankName} ****{a.last4} · {fmt(a.amount)}
                        </p>
                      ))}
                      {summary.money.inAccount.byAccount.length > 3 && (
                        <p className="text-[13px] text-[var(--color-text-soft)]">y {summary.money.inAccount.byAccount.length - 3} cuentas más</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {summary.money.pendingSettlement.total > 0.01 && (
                <div className="flex items-start gap-3">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-soft)]" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-[var(--color-text-muted)]">Por liquidar</span>
                      <span className="text-[20px] font-medium leading-none tabular-nums text-[var(--color-text-muted)]">{fmt(summary.money.pendingSettlement.total)}</span>
                    </div>
                    <p className="mt-1.5 text-[13px] text-[var(--color-text-soft)]">Pagos con tarjeta. El banco los deposita en 1-2 días.</p>
                  </div>
                </div>
              )}
            </div>
          )}

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
                            ? describeMovement(item, selfUserId)
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

          {activeSheet && activeSheet !== "POSTPONE" && (
            <SendCashSheet
              variant={activeSheet}
              branchId={branchId}
              cashSessionId={cashSessionId}
              availableToMove={summary.money.physical.availableToMove}
              bankAccounts={bankAccounts}
              selfUserId={selfUserId}
              selfFullName={selfFullName}
              onClose={() => setActiveSheet(null)}
              onDone={() => { setActiveSheet(null); void load(); }}
            />
          )}
          {activeSheet === "POSTPONE" && (
            <PostponeSheet
              cashSessionId={cashSessionId}
              availableToMove={summary.money.physical.availableToMove}
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
      {/* C.3 — neutro: con cinco filas, un acento por ícono compite demasiado; el acento queda para el hero y el botón de confirmar. */}
      <Icon className="h-6 w-6 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
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
 * Selector de persona en filas, no <select> nativo — en una terminal táctil
 * el select abre el selector del sistema operativo y no muestra el rol
 * (D.3). Misma forma que BankAccountPicker.
 */
function PersonPicker({ people, loaded, value, onChange }: { people: BranchPerson[]; loaded: boolean; value: string; onChange: (id: string) => void }) {
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

  const selected = people.find((p) => p.id === value) ?? null;
  const empty = loaded && people.length === 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !empty && setOpen((o) => !o)}
        disabled={empty}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-pay)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {empty ? (
          <span className="text-sm text-[var(--color-text-soft)]">No hay personas disponibles para seleccionar</span>
        ) : selected ? (
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-[var(--color-text)]">{selected.fullName}</span>
            <span className="block truncate text-xs text-[var(--color-text-muted)]">{selected.roleLabel}</span>
          </span>
        ) : (
          <span className="text-sm text-[var(--color-text-soft)]">{loaded ? "Selecciona una persona…" : "Cargando…"}</span>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-text-soft)]" aria-hidden="true" />
      </button>
      {open && !empty && (
        <div role="listbox" className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {people.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={p.id === value}
              onClick={() => { onChange(p.id); setOpen(false); }}
              className={[
                "flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--color-surface-alt)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-pay)]",
                p.id === value ? "bg-[var(--color-surface-alt)]" : "",
              ].join(" ")}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-[var(--color-text)]">{p.fullName}</span>
                <span className="block truncate text-xs text-[var(--color-text-muted)]">{p.roleLabel}</span>
              </span>
              {p.id === value ? (
                <Check className="h-4 w-4 shrink-0 text-[var(--color-pay)]" aria-hidden="true" />
              ) : (
                <span className="h-4 w-4 shrink-0 rounded-full border border-[var(--color-border-strong)]" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Las cuatro variantes salen de dos datos que ya existen — reason
 * (DEPOSIT_DISPATCH | HANDOVER) y si carrierUserId es el propio actor —
 * nunca de un tercer campo de "modo" que se pueda desincronizar (C.1/D.1).
 * Todas reusan sendCashOutToCustody (POST send-deposit).
 */
function SendCashSheet({ variant, branchId, cashSessionId, availableToMove, bankAccounts, selfUserId, selfFullName, onClose, onDone }: {
  variant: Exclude<SheetKind, "POSTPONE">;
  branchId: string;
  cashSessionId: string;
  availableToMove: number;
  bankAccounts: BankAccountOption[];
  selfUserId: string;
  selfFullName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const carriesSelf = variant === "SELF_TO_BANK" || variant === "SELF_TO_PERSON";
  const goesToBank = variant === "SELF_TO_BANK" || variant === "OTHER_TO_BANK";
  const picksRecipient = variant === "SELF_TO_PERSON";
  const picksCarrier = !carriesSelf;
  const needsPersonPicker = picksCarrier || picksRecipient;

  const [people, setPeople] = useState<BranchPerson[]>([]);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [amount, setAmount] = useState(availableToMove > 0 ? availableToMove.toFixed(2) : "");
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  // D.3 — reemplaza /api/branches/[id]/members: esa lista solo mira
  // UserBranchRole y deja afuera a Master cuando no tiene membresía de
  // sucursal (justo el caso que motiva "yo se lo llevo a alguien").
  useEffect(() => {
    if (!needsPersonPicker) return;
    apiFetch(`/api/cashier/branch-people?branchId=${branchId}`).then((r) => (r.ok ? r.json() : null))
      .then((raw) => { if (raw) setPeople(unwrapApiData(raw) as BranchPerson[]); })
      .catch(() => {})
      .finally(() => setPeopleLoaded(true));
  }, [needsPersonPicker, branchId]);

  // Si hay una sola cuenta, preseleccionala pero dejá el campo visible (B.5).
  useEffect(() => {
    if (goesToBank && bankAccounts.length === 1) setBankAccountId(bankAccounts[0].id);
  }, [goesToBank, bankAccounts]);

  useEffect(() => { setTimeout(() => firstFieldRef.current?.focus(), 50); }, []);

  const amountNumber = Number(amount) || 0;
  const overCap = amountNumber > availableToMove + 0.01;
  const title = SHEET_TITLES[variant];
  const selectedPerson = people.find((p) => p.id === selectedPersonId) ?? null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return; // mueve dinero real — el doble toque no puede duplicarlo.
    if (picksCarrier && !selectedPersonId) { toast.error(variant === "OTHER_TO_BANK" ? "Elegí quién lo lleva." : "Elegí quién lo recibe."); return; }
    if (picksRecipient && !selectedPersonId) { toast.error("Elegí a quién se lo vas a entregar."); return; }
    if (goesToBank && !bankAccountId) { toast.error("Elegí a qué cuenta va."); return; }
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
          carrierUserId: carriesSelf ? selfUserId : selectedPersonId,
          reason: goesToBank ? "DEPOSIT_DISPATCH" : "HANDOVER",
          bankAccountId: goesToBank ? bankAccountId : undefined,
          recipientUserId: picksRecipient ? selectedPersonId : undefined,
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

        {carriesSelf && (
          <p className="text-xs text-[var(--color-text-muted)]">
            Lo llevás vos: <span className="font-medium text-[var(--color-text)]">{selfFullName || "vos"}</span>
          </p>
        )}

        <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
          ¿Cuánto?
          <div className="mt-1 flex gap-2">
            <Input ref={firstFieldRef} type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={overCap ? "border-[var(--color-danger-400)]" : ""} required />
            <Button type="button" variant="ghost" size="sm" onClick={() => setAmount(availableToMove.toFixed(2))}>Todo</Button>
          </div>
          <span className={["mt-1 block text-[0.6875rem]", overCap ? "font-semibold text-[var(--color-danger-600)]" : "text-[var(--color-text-soft)]"].join(" ")}>
            Disponible: {fmt(availableToMove)}
          </span>
        </label>

        {needsPersonPicker && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">
              {picksRecipient ? "¿A quién se lo entregás?" : variant === "OTHER_TO_BANK" ? "¿Quién lo lleva?" : "¿Quién lo recibe?"}
            </label>
            <PersonPicker people={people} loaded={peopleLoaded} value={selectedPersonId} onChange={setSelectedPersonId} />
          </div>
        )}

        {goesToBank && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">¿A qué cuenta va?</label>
            <BankAccountPicker accounts={bankAccounts} value={bankAccountId} onChange={setBankAccountId} />
          </div>
        )}

        {carriesSelf && (
          <p className="rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
            {variant === "SELF_TO_BANK"
              ? "Queda a tu nombre hasta que Master confirme el depósito."
              : selectedPerson
              ? `Queda a tu nombre hasta que ${selectedPerson.fullName} confirme que lo recibió.`
              : "Queda a tu nombre hasta que la persona confirme que lo recibió."}
          </p>
        )}

        <Button type="submit" variant="success" loading={submitting} disabled={overCap} className="w-full" icon={<Check className="h-4 w-4" />}>
          Confirmar salida
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
