"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark, Plus, X, Check, RefreshCcw, PiggyBank, Wallet, Vault, Users, ArrowLeftRight, ChevronRight, AlarmClock, ListFilter, CreditCard, Banknote } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";
import { STATE_META, type CashPosition, type CashIndicatorState } from "@/components/navigation/cash-indicator-panel";
import { CashAccumulationBar } from "@/components/finance/cash-accumulation-bar";
import { RetainedCashExpenseSheet } from "@/components/finance/retained-cash-expense-sheet";
import { RetainedCashExpenseList } from "@/components/finance/retained-cash-expense-list";
import { DirectDepositSheet } from "@/components/finance/direct-deposit-sheet";

type Branch = { id: string; code: string; name: string; cashFundAmount: string | null };

type AccountType = "BANK" | "SETTLEMENT" | "CUSTODY" | "SAFE";

type TreasuryAccountBalance = {
  openingBalance: number;
  openingBalanceAt: string | null;
  totalIn: number;
  totalOut: number;
  balance: number;
  pendingOpening: boolean;
};

type TreasuryCard = {
  id: string;
  accountId: string;
  label: string;
  brand: string | null;
  last4: string | null;
  cardType: "DEBIT" | "CREDIT";
  isActive: boolean;
};

type BankAccount = {
  id: string;
  type: AccountType;
  bankName: string;
  accountAlias: string;
  accountNumber: string;
  currencyCode: string;
  branchId: string | null;
  isActive: boolean;
  owner: string | null;
  acceptsCustomerPayments: boolean;
  balance: TreasuryAccountBalance;
  cards?: TreasuryCard[];
};

type Position = {
  banks: { total: number; byCurrency: Record<string, number> };
  settlement: { total: number; byCurrency: Record<string, number> };
  safe: { total: number; byCurrency: Record<string, number> };
  custody: { total: number; byCurrency: Record<string, number> };
  latestExchangeRate: { rate: number; effectiveAt: string } | null;
  accountsPendingOpening: Array<{ id: string; bankName: string; accountAlias: string; type: AccountType }>;
};

type DepositPolicy = { id: string; branchId: string; thresholdAmount: string; maxDaysHolding: number };

type CashPositionRow = { branch: { id: string; code: string; name: string }; position: CashPosition; consecutivePostponements: number };

type DepositSummary = {
  period: { from: string; to: string };
  deposited: { total: number; count: number; accountsCount: number };
  byAccount: Array<{
    accountId: string;
    bankName: string;
    accountAlias: string;
    accountNumber: string;
    currencyCode: string;
    total: number;
    count: number;
    lastDepositAt: string | null;
  }>;
  byBranch: Array<{ branchId: string; branchName: string; total: number; count: number }>;
};

const fmt = (v: number) => `C$${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Orden de severidad (prompt-ajustes-finales-tesoreria.md §1/§2): la
 * sucursal más urgente encabeza la lista. Solo estos estados cuentan como
 * "necesita atención" — ACCUMULATING es información neutra (está juntando
 * efectivo con normalidad), no una alerta; contarlo como pendiente producía
 * un mensaje de alarma sin nada urgente en ningún lado (§2, la regresión
 * reportada en el sidebar de Master, corregida acá donde ahora vive el dato).
 */
const STATE_PRIORITY: Record<CashIndicatorState, number> = {
  CRITICAL: 0, OVERDUE: 1, READY: 2, APPROACHING: 3, ACCUMULATING: 4, IN_TRANSIT_ONLY: 5, CLEAR: 6,
};
const FLAGGED_STATES = new Set<CashIndicatorState>(["APPROACHING", "READY", "OVERDUE", "CRITICAL", "IN_TRANSIT_ONLY"]);

/**
 * prompt-libro-mayor-tesoreria.md §6 — la pantalla lidera con el dinero
 * (6.1 posición, 6.2 lista con saldo real), no con metadatos. La palabra
 * "esperado" no es adorno: Hammer no se conecta al banco.
 */
export default function TreasuryPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [position, setPosition] = useState<Position | null>(null);
  const [policies, setPolicies] = useState<DepositPolicy[]>([]);
  const [cashPositions, setCashPositions] = useState<CashPositionRow[]>([]);
  const [depositSummary, setDepositSummary] = useState<DepositSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [detailAccountId, setDetailAccountId] = useState<string | null>(null);
  const [expandedCashBranchId, setExpandedCashBranchId] = useState<string | null>(null);
  const [expenseSheetBranchId, setExpenseSheetBranchId] = useState<string | null>(null);
  const [expenseListRefreshKey, setExpenseListRefreshKey] = useState(0);
  const [depositSheetBranchId, setDepositSheetBranchId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [branchesRes, accountsRes, positionRes, policiesRes, cashPositionsRes, depositSummaryRes] = await Promise.all([
        apiFetch("/api/master/branches"),
        apiFetch("/api/master/treasury/bank-accounts/with-balances"),
        apiFetch("/api/master/treasury/position"),
        apiFetch("/api/master/treasury/deposit-policy"),
        apiFetch("/api/master/treasury/cash-positions"),
        apiFetch("/api/master/treasury/deposit-summary"),
      ]);
      const branchesRaw = await branchesRes.json();
      const accountsRaw = await accountsRes.json();
      const positionRaw = await positionRes.json();
      const policiesRaw = await policiesRes.json();
      const cashPositionsRaw = await cashPositionsRes.json();
      const depositSummaryRaw = await depositSummaryRes.json();
      if (!branchesRes.ok) throw new Error(branchesRaw?.error?.message ?? "No se pudieron cargar las sucursales.");
      if (!accountsRes.ok) throw new Error(accountsRaw?.error?.message ?? "No se pudieron cargar las cuentas.");
      if (!positionRes.ok) throw new Error(positionRaw?.error?.message ?? "No se pudo cargar la posición.");
      if (!policiesRes.ok) throw new Error(policiesRaw?.error?.message ?? "No se pudo cargar la política de depósito.");
      if (!cashPositionsRes.ok) throw new Error(cashPositionsRaw?.error?.message ?? "No se pudo cargar el efectivo por sucursal.");
      if (!depositSummaryRes.ok) throw new Error(depositSummaryRaw?.error?.message ?? "No se pudo cargar el resumen de depósitos.");
      setBranches(unwrapApiData(branchesRaw) as Branch[]);
      setAccounts(unwrapApiData(accountsRaw) as BankAccount[]);
      setPosition(unwrapApiData(positionRaw) as Position);
      setPolicies(unwrapApiData(policiesRaw) as DepositPolicy[]);
      setCashPositions(unwrapApiData(cashPositionsRaw) as CashPositionRow[]);
      setDepositSummary(unwrapApiData(depositSummaryRaw) as DepositSummary);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar Tesorería.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saveCashFund(branchId: string, value: string) {
    const parsed = value.trim() === "" ? null : Number(value);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      toast.error("El fondo de caja debe ser un número mayor o igual a 0.");
      return;
    }
    try {
      const res = await apiFetch(`/api/master/branches/${branchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashFundAmount: parsed }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo guardar el fondo de caja.");
      toast.success("Fondo de caja actualizado.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el fondo de caja.");
    }
  }

  async function savePolicy(branchId: string, thresholdAmount: string, maxDaysHolding: string) {
    const threshold = Number(thresholdAmount);
    const maxDays = Number(maxDaysHolding);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      toast.error("El umbral debe ser un número mayor que 0.");
      return;
    }
    if (!Number.isInteger(maxDays) || maxDays <= 0) {
      toast.error("Los días máximos deben ser un entero mayor que 0.");
      return;
    }
    try {
      const res = await apiFetch(`/api/master/treasury/deposit-policy?branchId=${branchId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thresholdAmount: threshold, maxDaysHolding: maxDays }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo guardar la política.");
      toast.success("Política de depósito actualizada.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la política.");
    }
  }

  async function toggleAccountActive(account: BankAccount) {
    try {
      const res = await apiFetch(`/api/master/treasury/bank-accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !account.isActive }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo actualizar la cuenta.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar la cuenta.");
    }
  }

  async function toggleAcceptsCustomerPayments(account: BankAccount) {
    try {
      const res = await apiFetch(`/api/master/treasury/bank-accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceptsCustomerPayments: !account.acceptsCustomerPayments }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo actualizar la cuenta.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar la cuenta.");
    }
  }

  const branchName = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name ?? id : "Todas las sucursales (central)");
  const bankAccountsOnly = accounts.filter((a) => a.type === "BANK");
  const otherAccounts = accounts.filter((a) => a.type !== "BANK");

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-1 rounded-full" style={{ background: "var(--color-master-600)" }} />
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-text)]">Tesorería</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Dónde está la plata ahora — los saldos se calculan del libro mayor, nunca se editan.</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" loading={loading} onClick={() => void load()} icon={<RefreshCcw className="h-3.5 w-3.5" />}>Actualizar</Button>
      </div>

      {/* 6.1 · Posición */}
      {position && (
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <PositionTile icon={Landmark} label="Bancos" data={position.banks} rate={position.latestExchangeRate} />
            <PositionTile icon={Wallet} label="Por liquidar" data={position.settlement} rate={position.latestExchangeRate} />
            <PositionTile icon={Vault} label="Caja fuerte" data={position.safe} rate={position.latestExchangeRate} />
            <PositionTile icon={Users} label="En tránsito" data={position.custody} rate={position.latestExchangeRate} amber />
          </div>
          <p className="mt-3 text-[0.6875rem] text-[var(--color-text-soft)]">
            &quot;En tránsito&quot; es plata en manos de una persona, sin destino confirmado todavía. No incluye las gavetas abiertas — eso vive en Caja, no en Tesorería (§1).
          </p>
          {position.accountsPendingOpening.length > 0 && (
            <p className="mt-2 rounded-lg bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
              {position.accountsPendingOpening.length} cuenta(s) sin saldo de apertura declarado — su saldo de abajo es solo el movimiento desde que se cargaron, no el real. Configuración → cargar apertura.
            </p>
          )}
        </Card>
      )}

      {/* Totales consolidados — Tesorería pasa de tablero informativo a operativo: cuánto hay
          acumulado/para depositar/en tránsito en las sucursales, y cuánto se depositó ya este mes. */}
      {cashPositions.length > 0 && <TreasuryTotalsBar cashPositions={cashPositions} depositSummary={depositSummary} />}

      {/* Efectivo por sucursal (prompt-ajustes-finales-tesoreria.md §1) — lo que antes vivía
          comprimido en el sidebar de Master, acá sin ninguna sucursal oculta detrás de un link. */}
      {cashPositions.length > 0 && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-[var(--color-master-600)]" />
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Efectivo por sucursal</h2>
            </div>
            {(() => {
              const urgentCount = cashPositions.filter((r) => FLAGGED_STATES.has(r.position.state)).length;
              return urgentCount > 0 ? <Badge variant="warning">{urgentCount} necesitan atención</Badge> : null;
            })()}
          </div>
          <div className="space-y-1.5">
            {[...cashPositions]
              .sort((a, b) => STATE_PRIORITY[a.position.state] - STATE_PRIORITY[b.position.state])
              .map((row) => (
                <CashPositionRowItem
                  key={row.branch.id}
                  branch={row.branch}
                  position={row.position}
                  consecutivePostponements={row.consecutivePostponements}
                  expanded={expandedCashBranchId === row.branch.id}
                  onToggle={() => setExpandedCashBranchId((current) => (current === row.branch.id ? null : row.branch.id))}
                  onRegisterExpense={() => setExpenseSheetBranchId(row.branch.id)}
                  onDeposit={() => setDepositSheetBranchId(row.branch.id)}
                  refreshKey={expenseListRefreshKey}
                />
              ))}
          </div>
        </Card>
      )}

      {/* 6.2 · Cuentas bancarias, con saldo real */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-[var(--color-master-600)]" />
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Cuentas bancarias</h2>
          </div>
          <Button variant="success" size="sm" onClick={() => setShowAddAccount(true)} icon={<Plus className="h-3.5 w-3.5" />}>Agregar cuenta</Button>
        </div>
        {bankAccountsOnly.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">Sin cuentas registradas todavía.</p>
        ) : (
          <div className="space-y-1.5">
            {bankAccountsOnly.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setDetailAccountId(a.id)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left hover:border-[var(--color-border-strong)]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[var(--color-text)]">{a.bankName}</span>
                      <Badge variant={a.currencyCode === "USD" ? "success" : "info"}>{a.currencyCode === "USD" ? "Dólares" : "Córdobas"}</Badge>
                      {!a.isActive && <Badge variant="neutral">Inactiva</Badge>}
                    </div>
                    <p className="truncate text-xs text-[var(--color-text-muted)]">{a.owner ?? a.accountAlias} · <span className="font-mono">{a.accountNumber}</span> · {branchName(a.branchId)}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    {a.balance.pendingOpening ? (
                      <span className="text-xs font-semibold text-[var(--color-warning-600)]">Pendiente de apertura</span>
                    ) : (
                      <span className="text-lg font-bold tabular-nums text-[var(--color-text)]">{a.currencyCode === "USD" ? "$" : "C$"}{a.balance.balance.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-[var(--color-text-soft)]" />
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Tarjetas ligadas + pagos SALIENTES desde una cuenta registrada */}
      <AccountPaymentsPanel accounts={bankAccountsOnly} onChanged={() => void load()} />

      {/* Cuentas de tesorería no-bancarias (SETTLEMENT/CUSTODY/SAFE) — de solo lectura salvo SAFE, que Master crea a mano */}
      {otherAccounts.length > 0 && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-[var(--color-master-600)]" />
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Por liquidar, custodia y caja fuerte</h2>
          </div>
          <div className="space-y-1.5">
            {otherAccounts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setDetailAccountId(a.id)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left hover:border-[var(--color-border-strong)]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral">{a.type === "SETTLEMENT" ? "Por liquidar" : a.type === "CUSTODY" ? "Custodia" : "Caja fuerte"}</Badge>
                    <span className="font-semibold text-[var(--color-text)]">{a.owner ?? a.accountAlias}</span>
                  </div>
                  <p className="truncate text-xs text-[var(--color-text-muted)]">{branchName(a.branchId)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-base font-bold tabular-nums text-[var(--color-text)]">{fmt(a.balance.balance)}</span>
                  <ChevronRight className="h-4 w-4 text-[var(--color-text-soft)]" />
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Confirmación de depósitos — Pantalla 4 */}
      <DepositConfirmationPanel bankAccounts={bankAccountsOnly} onConfirmed={() => void load()} />

      {/* §5 · Entradas por cuenta, en un rango */}
      <EntriesByAccountPanel branches={branches} />

      {/* 6.5 · Configuración, al final */}
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <PiggyBank className="h-4 w-4 text-[var(--color-master-600)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Fondo de caja por sucursal</h2>
        </div>
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">
          Lo que la sesión de caja debería poder abrir al día siguiente. Sin configurar, todo lo retenido cuenta como esperando depósito.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((branch) => (
            <CashFundEditor key={branch.id} branch={branch} onSave={saveCashFund} />
          ))}
        </div>
      </Card>

      {/* Política de depósito — la base del indicador de efectivo de la barra lateral */}
      <Card id="politica-de-deposito" className="scroll-mt-4 p-4">
        <div className="mb-3 flex items-center gap-2">
          <AlarmClock className="h-4 w-4 text-[var(--color-master-600)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Política de depósito por sucursal</h2>
        </div>
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">
          Umbral de efectivo acumulado y días máximos de retención — sin esto configurado, el indicador de efectivo de esa sucursal no calcula estado ni proyección.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((branch) => (
            <DepositPolicyEditor key={branch.id} branch={branch} policy={policies.find((p) => p.branchId === branch.id) ?? null} onSave={savePolicy} />
          ))}
        </div>
      </Card>

      {showAddAccount && (
        <AddBankAccountModal
          branches={branches}
          onClose={() => setShowAddAccount(false)}
          onSaved={() => { setShowAddAccount(false); void load(); }}
        />
      )}

      {detailAccountId && (
        <AccountDetailDrawer
          accountId={detailAccountId}
          account={accounts.find((a) => a.id === detailAccountId) ?? null}
          onClose={() => setDetailAccountId(null)}
          onChanged={() => void load()}
        />
      )}

      <RetainedCashExpenseSheet
        open={expenseSheetBranchId !== null}
        onClose={() => setExpenseSheetBranchId(null)}
        branchId={expenseSheetBranchId ?? ""}
        position={cashPositions.find((r) => r.branch.id === expenseSheetBranchId)?.position ?? null}
        bankAccounts={bankAccountsOnly}
        onSaved={() => { setExpenseListRefreshKey((k) => k + 1); void load(); }}
      />

      <DirectDepositSheet
        open={depositSheetBranchId !== null}
        onClose={() => setDepositSheetBranchId(null)}
        branchId={depositSheetBranchId ?? ""}
        branchName={branches.find((b) => b.id === depositSheetBranchId)?.name ?? ""}
        pendingDeposit={cashPositions.find((r) => r.branch.id === depositSheetBranchId)?.position.pendingDeposit ?? 0}
        accounts={bankAccountsOnly}
        onDone={() => void load()}
      />
    </section>
  );
}

function PositionTile({ icon: Icon, label, data, rate, amber }: {
  icon: typeof Landmark;
  label: string;
  data: { total: number; byCurrency: Record<string, number> };
  rate: { rate: number; effectiveAt: string } | null;
  amber?: boolean;
}) {
  const usd = data.byCurrency.USD ?? 0;
  const nio = data.byCurrency.NIO ?? 0;
  return (
    <div className={["rounded-xl border p-3", amber && data.total > 0 ? "border-[var(--color-warning-200)] bg-[var(--color-warning-50)]" : "border-[var(--color-border)] bg-[var(--color-surface-alt)]"].join(" ")}>
      <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <p className="mt-1 text-xl font-bold tabular-nums text-[var(--color-text)]">{fmt(nio)}</p>
      {usd !== 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">
          + ${usd.toLocaleString("es-NI", { minimumFractionDigits: 2 })} {rate ? `≈ ${fmt(usd * rate.rate)} (tasa ${rate.rate})` : "(sin tasa cargada)"}
        </p>
      )}
    </div>
  );
}

/**
 * Totales consolidados — Tesorería pasa de tablero informativo a operativo:
 * las tres primeras cifras se derivan de cashPositions ya cargado (sin fetch
 * extra); "Depositado (mes)" viene del nuevo resumen de depósitos. El
 * subtexto de "Depositado" expande el desglose por cuenta.
 */
function TreasuryTotalsBar({ cashPositions, depositSummary }: { cashPositions: CashPositionRow[]; depositSummary: DepositSummary | null }) {
  const [showByAccount, setShowByAccount] = useState(false);

  const totals = useMemo(() => {
    return cashPositions.reduce(
      (acc, row) => ({
        accumulated: acc.accumulated + row.position.accumulatedAmount,
        pendingDeposit: acc.pendingDeposit + row.position.pendingDeposit,
        inTransit: acc.inTransit + row.position.inTransitAmount,
      }),
      { accumulated: 0, pendingDeposit: 0, inTransit: 0 },
    );
  }, [cashPositions]);

  return (
    <Card className="p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TotalTile label="Total acumulado" value={totals.accumulated} />
        <TotalTile label="Total para depositar" value={totals.pendingDeposit} amber={totals.pendingDeposit > 0} />
        <TotalTile label="En tránsito" value={totals.inTransit} amber={totals.inTransit > 0} />
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
          <div className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Depositado (mes)</div>
          <p className="mt-1 text-xl font-bold tabular-nums text-[var(--color-text)]">{fmt(depositSummary?.deposited.total ?? 0)}</p>
          {depositSummary && depositSummary.deposited.count > 0 ? (
            <button
              type="button"
              onClick={() => setShowByAccount((v) => !v)}
              className="mt-0.5 text-xs text-[var(--color-pay)] hover:underline"
            >
              {depositSummary.deposited.count} depósito{depositSummary.deposited.count !== 1 ? "s" : ""} en {depositSummary.deposited.accountsCount} cuenta{depositSummary.deposited.accountsCount !== 1 ? "s" : ""}
            </button>
          ) : (
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Sin depósitos este mes</p>
          )}
        </div>
      </div>

      {showByAccount && depositSummary && depositSummary.byAccount.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-[var(--color-border)] pt-3">
          {depositSummary.byAccount.map((row) => (
            <div key={row.accountId} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--color-surface-alt)] px-3 py-2 text-xs">
              <div className="min-w-0">
                <span className="font-semibold text-[var(--color-text)]">{row.bankName} · {row.accountAlias}</span>
                <span className="ml-2 text-[var(--color-text-muted)]">
                  {row.count} depósito{row.count !== 1 ? "s" : ""}
                  {row.lastDepositAt ? ` · última ${new Date(row.lastDepositAt).toLocaleDateString("es-NI", { day: "2-digit", month: "2-digit" })}` : ""}
                </span>
              </div>
              <span className="shrink-0 font-mono font-bold tabular-nums text-[var(--color-text)]">{fmt(row.total)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TotalTile({ label, value, amber }: { label: string; value: number; amber?: boolean }) {
  return (
    <div className={["rounded-xl border p-3", amber ? "border-[var(--color-warning-200)] bg-[var(--color-warning-50)]" : "border-[var(--color-border)] bg-[var(--color-surface-alt)]"].join(" ")}>
      <div className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div>
      <p className="mt-1 text-xl font-bold tabular-nums text-[var(--color-text)]">{fmt(value)}</p>
    </div>
  );
}

function CashPositionRowItem({
  branch,
  position,
  consecutivePostponements,
  expanded,
  onToggle,
  onRegisterExpense,
  onDeposit,
  refreshKey,
}: {
  branch: { id: string; code: string; name: string };
  position: CashPosition;
  consecutivePostponements: number;
  expanded: boolean;
  onToggle: () => void;
  onRegisterExpense: () => void;
  onDeposit: () => void;
  refreshKey: number;
}) {
  const meta = STATE_META[position.state];
  return (
    <div
      className={[
        "rounded-lg border",
        meta.tone === "critical" ? "border-[var(--color-danger-200)] bg-[var(--color-danger-50)]" :
        meta.tone === "amber" ? "border-[var(--color-warning-200)] bg-[var(--color-warning-50)]" :
        "border-[var(--color-border)] bg-[var(--color-surface)]",
      ].join(" ")}
    >
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 p-3 text-left">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[var(--color-text)]">{branch.name}</span>
            <Badge variant={meta.tone === "critical" ? "danger" : meta.tone === "amber" ? "warning" : "neutral"}>{meta.label}</Badge>
            {/* Si el cajero declara una posposición y Master nunca la ve, posponer
                es un botón que solo sirve para que la plata se quede quieta sin
                que nadie se entere (Parte 3). */}
            {consecutivePostponements > 0 && <Badge variant="warning">Pospuesto {consecutivePostponements}x</Badge>}
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            En caja hoy {fmt(position.cashInDrawerToday)} · Acumulado {fmt(position.accumulatedAmount)}
            {position.inTransitAmount > 0.01 ? ` · En tránsito ${fmt(position.inTransitAmount)}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-[var(--color-text-muted)]">Para depositar</p>
          <p className="font-mono text-base font-bold tabular-nums text-[var(--color-text)]">{fmt(position.pendingDeposit)}</p>
          {position.pendingDepositNote && <p className="text-[0.6875rem] italic text-[var(--color-text-soft)]">{position.pendingDepositNote}</p>}
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-[var(--color-border)] p-3">
          <CashAccumulationBar position={position} configureHref="#politica-de-deposito" />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={onRegisterExpense}>Registrar gasto con efectivo retenido</Button>
            <Button
              variant="success"
              size="sm"
              onClick={onDeposit}
              disabled={position.pendingDeposit <= 0.01}
              title={position.pendingDeposit <= 0.01 ? "Nada disponible para depositar" : undefined}
            >
              Depositar a cuenta
            </Button>
          </div>
          <RetainedCashExpenseList branchId={branch.id} refreshKey={refreshKey} />
        </div>
      )}
    </div>
  );
}

function CashFundEditor({ branch, onSave }: { branch: Branch; onSave: (branchId: string, value: string) => Promise<void> }) {
  const [value, setValue] = useState(branch.cashFundAmount ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = value !== (branch.cashFundAmount ?? "");

  async function save() {
    setSaving(true);
    try {
      await onSave(branch.id, value);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] p-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-[var(--color-text)]">{branch.name}</div>
        <div className="text-[10px] text-[var(--color-text-muted)]">{branch.code}</div>
      </div>
      <Input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Sin configurar" className="w-28 text-xs" />
      {dirty && (
        <Button variant="secondary" size="sm" loading={saving} onClick={() => void save()} icon={<Check className="h-3.5 w-3.5" />}>Guardar</Button>
      )}
    </div>
  );
}

function DepositPolicyEditor({ branch, policy, onSave }: { branch: Branch; policy: DepositPolicy | null; onSave: (branchId: string, thresholdAmount: string, maxDaysHolding: string) => Promise<void> }) {
  const [threshold, setThreshold] = useState(policy?.thresholdAmount ?? "");
  const [maxDays, setMaxDays] = useState(policy ? String(policy.maxDaysHolding) : "");
  const [saving, setSaving] = useState(false);
  const dirty = threshold !== (policy?.thresholdAmount ?? "") || maxDays !== (policy ? String(policy.maxDaysHolding) : "");

  async function save() {
    setSaving(true);
    try {
      await onSave(branch.id, threshold, maxDays);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-[var(--color-text)]">{branch.name}</div>
          <div className="text-[10px] text-[var(--color-text-muted)]">{branch.code}</div>
        </div>
        {dirty && (
          <Button variant="secondary" size="sm" loading={saving} onClick={() => void save()} icon={<Check className="h-3.5 w-3.5" />}>Guardar</Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[10px] font-semibold text-[var(--color-text-muted)]">
          Umbral (C$)
          <Input type="number" min="0.01" step="0.01" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Sin configurar" className="mt-0.5 text-xs" />
        </label>
        <label className="block text-[10px] font-semibold text-[var(--color-text-muted)]">
          Días máx.
          <Input type="number" min="1" step="1" value={maxDays} onChange={(e) => setMaxDays(e.target.value)} placeholder="Sin configurar" className="mt-0.5 text-xs" />
        </label>
      </div>
    </div>
  );
}

type EntriesByAccountRow = {
  account: { id: string; bankName: string; accountAlias: string; accountNumber: string; currencyCode: string };
  total: number;
  breakdown: Array<{ entryType: string; total: number; count: number }>;
};

/** §5 · No es lo mismo que entren depósitos de sucursal que transferencias de clientes — desglose por tipo, no solo un total. */
function EntriesByAccountPanel({ branches }: { branches: Branch[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState("");
  const [rows, setRows] = useState<EntriesByAccountRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59`).toISOString() });
      if (branchId) params.set("branchId", branchId);
      const res = await apiFetch(`/api/master/treasury/entries-by-account?${params.toString()}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudieron cargar las entradas.");
      setRows(unwrapApiData(raw) as EntriesByAccountRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar las entradas.");
    } finally {
      setLoading(false);
    }
  }, [from, to, branchId]);

  useEffect(() => { void search(); }, [search]);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <ListFilter className="h-4 w-4 text-[var(--color-master-600)]" />
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Entradas por cuenta</h2>
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="block text-[10px] font-semibold text-[var(--color-text-muted)]">
          Desde
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-0.5 text-xs" />
        </label>
        <label className="block text-[10px] font-semibold text-[var(--color-text-muted)]">
          Hasta
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-0.5 text-xs" />
        </label>
        <label className="block text-[10px] font-semibold text-[var(--color-text-muted)]">
          Sucursal
          <select className="hm-input mt-0.5 text-xs" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Todas</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
          </select>
        </label>
        <Button variant="ghost" size="sm" loading={loading} onClick={() => void search()} icon={<RefreshCcw className="h-3.5 w-3.5" />}>Buscar</Button>
      </div>
      {loading ? (
        <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">Cargando…</p>
      ) : !rows || rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">Sin entradas en este rango.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.account.id} className="rounded-lg border border-[var(--color-border)] p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--color-text)]">{row.account.bankName} · {row.account.accountAlias}</span>
                <span className="font-mono text-sm font-bold tabular-nums text-[var(--color-text)]">{fmt(row.total)}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {row.breakdown.map((b) => (
                  <span key={b.entryType} className="hm-chip hm-chip-warning">
                    {ENTRY_TYPE_LABEL[b.entryType] ?? b.entryType}: {fmt(b.total)} ({b.count})
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AddBankAccountModal({ branches, onClose, onSaved }: { branches: Branch[]; onClose: () => void; onSaved: () => void }) {
  const [bankName, setBankName] = useState("");
  const [owner, setOwner] = useState("");
  const [accountAlias, setAccountAlias] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [currencyCode, setCurrencyCode] = useState("NIO");
  const [branchId, setBranchId] = useState<string>("");
  const [acceptsCustomerPayments, setAcceptsCustomerPayments] = useState(true);
  const [accountType, setAccountType] = useState<"BANK" | "SAFE">("BANK");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch("/api/master/treasury/bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankName, accountAlias, accountNumber, currencyCode,
          branchId: branchId || null,
          owner: owner.trim() || null,
          acceptsCustomerPayments,
          type: accountType,
        }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo registrar la cuenta.");
      toast.success("Cuenta registrada.");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar la cuenta.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Agregar cuenta</h3>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} icon={<X className="h-4 w-4" />}>Cerrar</Button>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Tipo</label>
          <div className="inline-flex rounded-lg border border-[var(--color-border)] p-0.5">
            <button type="button" onClick={() => setAccountType("BANK")} className={["rounded-md px-3 py-1.5 text-xs font-medium", accountType === "BANK" ? "bg-[var(--color-pay)] text-white" : "text-[var(--color-text-secondary)]"].join(" ")}>Cuenta bancaria</button>
            <button type="button" onClick={() => setAccountType("SAFE")} className={["rounded-md px-3 py-1.5 text-xs font-medium", accountType === "SAFE" ? "bg-[var(--color-pay)] text-white" : "text-[var(--color-text-secondary)]"].join(" ")}>Caja fuerte</button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">{accountType === "SAFE" ? "Descripción" : "Banco"}</label>
          <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder={accountType === "SAFE" ? "Caja fuerte" : "BAC, BANPRO, Lafise…"} required />
        </div>
        {accountType === "BANK" && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Titular de la cuenta</label>
            <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Nombre completo, como en el estado de cuenta" />
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Alias / descripción</label>
          <Input value={accountAlias} onChange={(e) => setAccountAlias(e.target.value)} placeholder="Córdobas Managua" required />
        </div>
        {accountType === "BANK" && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Número de cuenta</label>
            <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} required />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Moneda</label>
            <select className="hm-input w-full" value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
              <option value="NIO">NIO (córdobas)</option>
              <option value="USD">USD (dólares)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Sucursal</label>
            <select className="hm-input w-full" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Central (todas)</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
            </select>
          </div>
        </div>
        {accountType === "BANK" && (
          <label className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-muted)]">
            <input type="checkbox" checked={acceptsCustomerPayments} onChange={(e) => setAcceptsCustomerPayments(e.target.checked)} />
            Acepta pagos de clientes (aparece en el cobro por transferencia)
          </label>
        )}
        <Button type="submit" variant="success" loading={saving} className="w-full" icon={<Check className="h-4 w-4" />}>Guardar</Button>
      </form>
    </div>
  );
}

type LedgerRow = {
  id: string;
  direction: "IN" | "OUT";
  amount: number;
  entryType: string;
  counterpartyType: string;
  counterpartyName: string | null;
  reference: string | null;
  notes: string | null;
  occurredAt: string;
  runningBalance: number;
};

const ENTRY_TYPE_LABEL: Record<string, string> = {
  SALE_TRANSFER: "Venta · transferencia",
  SALE_CARD: "Venta · tarjeta",
  CARD_SETTLEMENT: "Liquidación de tarjeta",
  CARD_FEE: "Comisión de tarjeta",
  DEPOSIT_DISPATCH: "Enviado a depositar",
  HANDOVER: "Entregado en persona",
  RETAIN_TO_SAFE: "Retenido en caja fuerte",
  DEPOSIT_CONFIRMED: "Depósito confirmado",
  SUPPLIER_PAYMENT: "Pago a proveedor",
  PAYROLL: "Planilla",
  EXPENSE: "Gasto",
  CUSTOMER_ADVANCE: "Anticipo de cliente",
  RECONCILIATION: "Ajuste de conciliación",
};

/** 6.3 · Detalle de cuenta — fecha · concepto · movimiento · saldo. */
function AccountDetailDrawer({ accountId, account, onClose, onChanged }: { accountId: string; account: BankAccount | null; onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [rangeStartBalance, setRangeStartBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showOpeningForm, setShowOpeningForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/master/treasury/bank-accounts/${accountId}/ledger`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar el detalle.");
      const data = unwrapApiData(raw) as { rows: LedgerRow[]; rangeStartBalance: number };
      setRows(data.rows);
      setRangeStartBalance(data.rangeStartBalance);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar el detalle.");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  function exportCsv() {
    if (!rows) return;
    const header = "fecha,concepto,contraparte,referencia,direccion,monto,saldo\n";
    const body = rows.map((r) => [
      new Date(r.occurredAt).toISOString().slice(0, 10),
      ENTRY_TYPE_LABEL[r.entryType] ?? r.entryType,
      r.counterpartyName ?? "",
      r.reference ?? "",
      r.direction,
      r.amount.toFixed(2),
      r.runningBalance.toFixed(2),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([header + body], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tesoreria-${account?.accountAlias ?? accountId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40">
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-[var(--color-surface)] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[var(--color-text)]">{account?.bankName ?? "Cuenta"}</h3>
            <p className="text-xs text-[var(--color-text-muted)]">{account?.owner ?? account?.accountAlias} {account?.accountNumber ? `· ${account.accountNumber}` : ""}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={exportCsv}>Exportar CSV</Button>
            <Button variant="ghost" size="sm" onClick={onClose} icon={<X className="h-4 w-4" />}>Cerrar</Button>
          </div>
        </div>

        {account?.balance.pendingOpening && (
          <div className="mb-4 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3">
            <p className="text-sm font-semibold text-[var(--color-warning-700)]">Pendiente de apertura</p>
            <p className="mt-0.5 text-xs text-[var(--color-warning-700)]">Sin un saldo de apertura declarado, el número de abajo es solo el movimiento del libro, no el saldo real de la cuenta.</p>
            {!showOpeningForm ? (
              <Button variant="secondary" size="sm" className="mt-2" onClick={() => setShowOpeningForm(true)}>Declarar saldo de apertura</Button>
            ) : (
              <OpeningBalanceForm accountId={accountId} onSaved={() => { setShowOpeningForm(false); onChanged(); void load(); }} onCancel={() => setShowOpeningForm(false)} />
            )}
          </div>
        )}

        <div className="mb-3 flex items-center justify-between rounded-lg bg-[var(--color-surface-alt)] px-3 py-2">
          <span className="text-xs text-[var(--color-text-muted)]">Saldo inicial del rango</span>
          <span className="font-mono text-sm font-semibold tabular-nums">{fmt(rangeStartBalance)}</span>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">Cargando…</p>
        ) : !rows || rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">Sin movimientos todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="hm-table w-full text-xs">
              <thead>
                <tr><th>Fecha</th><th>Concepto</th><th className="text-right">Movimiento</th><th className="text-right">Saldo</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{new Date(r.occurredAt).toLocaleDateString("es-NI", { day: "2-digit", month: "2-digit", year: "numeric" })}</td>
                    <td>
                      <p className="font-medium text-[var(--color-text)]">{ENTRY_TYPE_LABEL[r.entryType] ?? r.entryType}</p>
                      {(r.counterpartyName || r.reference) && (
                        <p className="text-[0.6875rem] text-[var(--color-text-muted)]">{[r.counterpartyName, r.reference].filter(Boolean).join(" · ")}</p>
                      )}
                    </td>
                    <td className={["text-right font-mono tabular-nums", r.direction === "IN" ? "text-[var(--color-success-700)]" : "text-[var(--color-danger-600)]"].join(" ")}>
                      {r.direction === "IN" ? "+" : "−"}{r.amount.toLocaleString("es-NI", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="text-right font-mono tabular-nums text-[var(--color-text)]">{r.runningBalance.toLocaleString("es-NI", { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function OpeningBalanceForm({ accountId, onSaved, onCancel }: { accountId: string; onSaved: () => void; onCancel: () => void }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  async function submit() {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed)) {
      toast.error("Monto inválido.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/master/treasury/bank-accounts/${accountId}/opening-balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingBalance: parsed, openingBalanceAt: date }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo declarar la apertura.");
      toast.success("Saldo de apertura declarado. El libro corre desde acá.");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo declarar la apertura.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-surface)] p-3">
      <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
        Saldo real, tomado del estado de cuenta
        <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="mt-1" />
      </label>
      <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
        A esta fecha de corte
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
      </label>
      <p className="text-[0.6875rem] text-[var(--color-text-soft)]">Nada anterior a esta fecha se reconstruye — el libro corre desde acá.</p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button variant="success" size="sm" loading={saving} onClick={() => void submit()} icon={<Check className="h-3.5 w-3.5" />}>Declarar apertura</Button>
      </div>
    </div>
  );
}

type CustodyRow = {
  account: { id: string; accountAlias: string; branch: { id: string; code: string; name: string } | null; holderUser: { id: string; fullName: string } | null };
  balance: TreasuryAccountBalance;
};

/**
 * Pantalla 4 · Confirmación — Master resuelve una custodia específica, no
 * "agrega un depósito suelto" (prompt-libro-mayor-tesoreria.md §3, §7
 * pruebas 6-7). Si confirma menos de lo que hay en custodia, el resto se
 * queda ahí — no se ajusta solo.
 */
function DepositConfirmationPanel({ bankAccounts, onConfirmed }: { bankAccounts: BankAccount[]; onConfirmed: () => void }) {
  const [custodies, setCustodies] = useState<CustodyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CustodyRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/master/treasury/custody-accounts");
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar custodia.");
      setCustodies(unwrapApiData(raw) as CustodyRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar custodia.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!loading && custodies.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-[var(--color-master-600)]" />
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Depósitos en tránsito, esperando confirmación</h2>
      </div>
      {loading ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">Cargando…</p>
      ) : (
        <div className="space-y-1.5">
          {custodies.map((row) => (
            <div key={row.account.id} className="rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text)]">{row.account.holderUser?.fullName ?? row.account.accountAlias}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{row.account.branch?.name ?? "Central"} · Enviado {fmt(row.balance.balance)}</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setSelected(row)}>Confirmar</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {selected && (
        <ConfirmDepositForm
          custody={selected}
          bankAccounts={bankAccounts}
          onClose={() => setSelected(null)}
          onConfirmed={() => { setSelected(null); void load(); onConfirmed(); }}
        />
      )}
    </Card>
  );
}

function ConfirmDepositForm({ custody, bankAccounts, onClose, onConfirmed }: { custody: CustodyRow; bankAccounts: BankAccount[]; onClose: () => void; onConfirmed: () => void }) {
  const [bankAccountId, setBankAccountId] = useState("");
  const [amount, setAmount] = useState(custody.balance.balance.toFixed(2));
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const amountNumber = Number(amount) || 0;
  const remainder = Math.max(0, Math.round((custody.balance.balance - amountNumber) * 100) / 100);
  const discrepant = remainder > 0.01;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!bankAccountId) {
      toast.error("Elegí a cuál cuenta bancaria entró.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/master/treasury/bank-accounts/${bankAccountId}/deposits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          custodyAccountId: custody.account.id,
          bankAccountId,
          branchId: custody.account.branch?.id ?? bankAccounts.find((a) => a.id === bankAccountId)?.branchId,
          amount: amountNumber,
          referenceNumber: referenceNumber.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo confirmar el depósito.");
      toast.success(discrepant ? `Depósito confirmado. Quedan ${fmt(remainder)} en custodia.` : "Depósito confirmado.");
      onConfirmed();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo confirmar el depósito.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Confirmar depósito</h3>
            <p className="text-xs text-[var(--color-text-muted)]">{custody.account.holderUser?.fullName ?? custody.account.accountAlias} · Enviado {fmt(custody.balance.balance)}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} icon={<X className="h-4 w-4" />}>Cerrar</Button>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Cuenta destino</label>
          <select className="hm-input w-full" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} required>
            <option value="">Selecciona una cuenta…</option>
            {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.bankName} · {a.owner ?? a.accountAlias} · {a.accountNumber}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Monto confirmado</label>
          <Input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        {discrepant && (
          <p className="rounded-lg bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
            Confirmando menos de lo enviado. Quedan {fmt(remainder)} en la custodia de {custody.account.holderUser?.fullName ?? "esta persona"} — no se ajusta solo.
          </p>
        )}
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Referencia (REF#)</label>
          <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Nombre en boleta</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Nombre completo de quien depositó" />
        </div>
        <Button type="submit" variant="success" loading={saving} className="w-full" icon={<Check className="h-4 w-4" />}>Confirmar depósito</Button>
      </form>
    </div>
  );
}



/**
 * Tarjetas ligadas a una cuenta + registro de pagos que SALEN de esa cuenta
 * (proveedor, planilla, gasto). Es la contraparte del cobro: el cobro entra
 * por venta, el pago sale por acá y baja el saldo esperado de la MISMA cuenta.
 * "Esperado" porque Hammer no se conecta al banco — refleja lo que el negocio
 * registró, no el extracto bancario.
 */
function AccountPaymentsPanel({ accounts, onChanged }: { accounts: BankAccount[]; onChanged: () => void }) {
  const [accountId, setAccountId] = useState("");
  const [entryType, setEntryType] = useState<"SUPPLIER_PAYMENT" | "PAYROLL" | "EXPENSE">("SUPPLIER_PAYMENT");
  const [cardId, setCardId] = useState("");
  const [amount, setAmount] = useState("");
  const [counterpartyName, setCounterpartyName] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const cards = account?.cards ?? [];
  const cardType = entryType === "PAYROLL" ? "EMPLOYEE" : "SUPPLIER";

  async function submitPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!accountId) { toast.error("Selecciona la cuenta de la que sale el pago."); return; }
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) { toast.error("El monto debe ser mayor que 0."); return; }
    setSaving(true);
    try {
      const res = await apiFetch("/api/master/treasury/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          amount: numeric,
          entryType,
          counterpartyType: cardType,
          counterpartyName: counterpartyName.trim() || null,
          cardId: cardId || null,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo registrar el pago.");
      toast.success("Pago registrado. El saldo de la cuenta bajó.");
      setAmount(""); setCounterpartyName(""); setReference(""); setNotes(""); setCardId("");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar el pago.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Banknote className="h-4 w-4 text-[var(--color-master-600)]" />
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Pagos desde cuentas</h2>
      </div>
      <p className="mb-3 text-xs text-[var(--color-text-muted)]">
        Registra un pago a proveedor, planilla o gasto que sale de una cuenta registrada — baja su saldo esperado. Si se paga con una tarjeta ligada a la cuenta, queda el rastro de con cuál.
      </p>

      {accounts.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">Agrega una cuenta bancaria primero.</p>
      ) : (
        <form onSubmit={submitPayment} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Cuenta de origen</label>
              <select className="hm-input w-full" value={accountId} onChange={(e) => { setAccountId(e.target.value); setCardId(""); }} required>
                <option value="">Selecciona una cuenta…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.bankName} · {a.owner ?? a.accountAlias} · {a.accountNumber}
                    {a.balance.pendingOpening ? " (pendiente de apertura)" : ` · ${a.currencyCode === "USD" ? "$" : "C$"}${a.balance.balance.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Tipo de pago</label>
              <select className="hm-input w-full" value={entryType} onChange={(e) => setEntryType(e.target.value as typeof entryType)}>
                <option value="SUPPLIER_PAYMENT">Proveedor</option>
                <option value="PAYROLL">Planilla</option>
                <option value="EXPENSE">Gasto</option>
              </select>
            </div>
          </div>

          {account && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-muted)]">
                  <CreditCard className="h-3.5 w-3.5" /> Tarjetas de esta cuenta
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddCard((v) => !v)} icon={<Plus className="h-3.5 w-3.5" />}>
                  {showAddCard ? "Cancelar" : "Agregar tarjeta"}
                </Button>
              </div>
              {cards.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">Sin tarjetas ligadas. El pago se registra como transferencia/efectivo de la cuenta.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setCardId("")}
                    className={["rounded-md border px-2.5 py-1 text-xs", cardId === "" ? "border-[var(--color-master-500)] bg-[var(--color-master-50)] font-semibold" : "border-[var(--color-border)]"].join(" ")}>
                    Sin tarjeta
                  </button>
                  {cards.map((c) => (
                    <button key={c.id} type="button" onClick={() => setCardId(c.id)}
                      className={["rounded-md border px-2.5 py-1 text-xs", cardId === c.id ? "border-[var(--color-master-500)] bg-[var(--color-master-50)] font-semibold" : "border-[var(--color-border)]"].join(" ")}>
                      {c.label}{c.last4 ? ` ··${c.last4}` : ""} <Badge variant="neutral">{c.cardType === "CREDIT" ? "Crédito" : "Débito"}</Badge>
                    </button>
                  ))}
                </div>
              )}
              {showAddCard && (
                <AddCardForm accountId={account.id} onSaved={() => { setShowAddCard(false); onChanged(); }} />
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Monto</label>
              <Input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">{entryType === "PAYROLL" ? "Empleado" : "Proveedor / beneficiario"}</label>
              <Input value={counterpartyName} onChange={(e) => setCounterpartyName(e.target.value)} placeholder="Nombre" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Referencia</label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="No. de factura / comprobante" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Notas</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <Button type="submit" variant="success" loading={saving} className="w-full sm:w-auto" icon={<Check className="h-4 w-4" />}>Registrar pago</Button>
        </form>
      )}
    </Card>
  );
}

function AddCardForm({ accountId, onSaved }: { accountId: string; onSaved: () => void }) {
  const [label, setLabel] = useState("");
  const [brand, setBrand] = useState("");
  const [last4, setLast4] = useState("");
  const [cardType, setCardType] = useState<"DEBIT" | "CREDIT">("DEBIT");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!label.trim()) { toast.error("Ponle un nombre a la tarjeta."); return; }
    if (last4 && !/^\d{4}$/.test(last4)) { toast.error("Los últimos 4 deben ser 4 dígitos."); return; }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/master/treasury/bank-accounts/${accountId}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), brand: brand.trim() || null, last4: last4 || null, cardType }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo agregar la tarjeta.");
      toast.success("Tarjeta agregada.");
      setLabel(""); setBrand(""); setLast4(""); setCardType("DEBIT");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo agregar la tarjeta.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-2 border-t border-[var(--color-border)] pt-3 sm:grid-cols-4">
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nombre (ej. BAC Empresarial)" className="sm:col-span-2" />
      <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Marca (VISA…)" />
      <Input value={last4} onChange={(e) => setLast4(e.target.value)} placeholder="Últimos 4" maxLength={4} inputMode="numeric" />
      <select className="hm-input" value={cardType} onChange={(e) => setCardType(e.target.value as "DEBIT" | "CREDIT")}>
        <option value="DEBIT">Débito</option>
        <option value="CREDIT">Crédito</option>
      </select>
      <Button type="submit" variant="secondary" size="sm" loading={saving} className="sm:col-span-3" icon={<Plus className="h-3.5 w-3.5" />}>Guardar tarjeta</Button>
    </form>
  );
}
