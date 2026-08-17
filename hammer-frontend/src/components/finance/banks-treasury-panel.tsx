"use client";

import { useCallback, useEffect, useState } from "react";
import { Landmark, RefreshCcw, X, Check, AlertTriangle } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";

type Branch = { id: string; code: string; name: string };

type AccountBalance = {
  confirmedDeposits: number;
  transfersReceived: number;
  paymentsMadeFromAccount: number;
  expectedBalance: number;
};

type BankAccountWithBalance = {
  id: string;
  bankName: string;
  accountAlias: string;
  accountNumber: string;
  currency: string;
  branchId: string | null;
  isActive: boolean;
  balance: AccountBalance;
};

type ExposureStatus = {
  outstandingAmount: number;
  oldestOutstandingDate: string | null;
  businessDaysWithoutDeposit: number;
  alert: { exceeds: boolean };
};

/**
 * Panel de Bancos y efectivo (correccion-destino-y-pantalla-cobro.md §5,
 * último paso pendiente). Saldo esperado = depósitos confirmados +
 * transferencias recibidas − pagos hechos desde la cuenta (§2.2; el tercer
 * término todavía no existe como funcionalidad en Hammer, queda en 0).
 */
export function BanksTreasuryPanel() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [accounts, setAccounts] = useState<BankAccountWithBalance[]>([]);
  const [exposure, setExposure] = useState<ExposureStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [depositTarget, setDepositTarget] = useState<BankAccountWithBalance | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const branchesRes = await apiFetch("/api/master/branches");
      const branchesRaw = await branchesRes.json();
      if (!branchesRes.ok) throw new Error(branchesRaw?.error?.message ?? "No se pudieron cargar las sucursales.");
      const branchList = unwrapApiData(branchesRaw) as Branch[];
      setBranches(branchList);

      const accountsRes = await apiFetch("/api/master/treasury/bank-accounts/with-balances");
      const accountsRaw = await accountsRes.json();
      if (!accountsRes.ok) throw new Error(accountsRaw?.error?.message ?? "No se pudieron cargar las cuentas.");
      setAccounts(unwrapApiData(accountsRaw) as BankAccountWithBalance[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar el panel de Bancos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selectedBranchId) { setExposure(null); return; }
    apiFetch(`/api/master/treasury/exposure?branchId=${selectedBranchId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => setExposure(raw ? (unwrapApiData(raw) as ExposureStatus) : null))
      .catch(() => setExposure(null));
  }, [selectedBranchId]);

  const branchName = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name ?? id : "Central (todas)");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-[var(--color-master-600)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Bancos y efectivo</h2>
        </div>
        <Button variant="ghost" size="sm" loading={loading} onClick={() => void load()} icon={<RefreshCcw className="h-3.5 w-3.5" />}>Actualizar</Button>
      </div>

      {/* Saldo esperado por cuenta */}
      <Card className="p-4">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Saldo esperado por cuenta</h3>
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">Depósitos confirmados + transferencias recibidas a esa cuenta. No es un estado de cuenta bancario — es lo que Hammer espera ver ahí.</p>
        {accounts.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">Sin cuentas registradas. Agrégalas desde Tesorería.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="hm-table w-full">
              <thead>
                <tr><th>Cuenta</th><th>Sucursal</th><th className="text-right">Depósitos</th><th className="text-right">Transferencias</th><th className="text-right">Saldo esperado</th><th></th></tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="font-medium">{a.bankName}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{a.accountAlias} · {a.accountNumber}</div>
                    </td>
                    <td className="text-xs">{branchName(a.branchId)}</td>
                    <td className="text-right font-mono text-xs">C$ {a.balance.confirmedDeposits.toFixed(2)}</td>
                    <td className="text-right font-mono text-xs">C$ {a.balance.transfersReceived.toFixed(2)}</td>
                    <td className="text-right font-mono text-sm font-semibold">C$ {a.balance.expectedBalance.toFixed(2)}</td>
                    <td>
                      <Button variant="secondary" size="sm" onClick={() => setDepositTarget(a)}>Registrar depósito</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Exposición de efectivo esperando depósito, por sucursal */}
      <Card className="p-4">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Efectivo esperando depósito</h3>
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">Informa, nunca bloquea. Retener C$50,000 dos días es normal — esto solo ayuda a notar cuando deja de serlo.</p>
        <select className="hm-input mb-3 w-full sm:w-64" value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)}>
          <option value="">Selecciona una sucursal…</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
        </select>
        {selectedBranchId && exposure && (
          <div className={["flex items-center gap-3 rounded-lg border p-3 text-sm",
            exposure.alert.exceeds ? "border-[var(--color-warning-300)] bg-[var(--color-warning-50)]" : "border-[var(--color-border)]"].join(" ")}>
            {exposure.alert.exceeds && <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--color-warning-700)]" />}
            <div>
              <span className="font-semibold">C$ {exposure.outstandingAmount.toFixed(2)}</span> esperando depósito
              {exposure.businessDaysWithoutDeposit > 0 && <> · hace <span className="font-semibold">{exposure.businessDaysWithoutDeposit}</span> día(s) hábiles</>}
            </div>
          </div>
        )}
      </Card>

      {depositTarget && (
        <ConfirmDepositModal account={depositTarget} onClose={() => setDepositTarget(null)} onSaved={() => { setDepositTarget(null); void load(); }} />
      )}
    </div>
  );
}

function ConfirmDepositModal({ account, onClose, onSaved }: { account: BankAccountWithBalance; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!account.branchId) {
      toast.error("Esta cuenta es central (sin sucursal) — todavía no se puede confirmar un depósito sin elegir a cuál sucursal pertenece.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/master/treasury/bank-accounts/${account.id}/deposits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankAccountId: account.id, branchId: account.branchId, amount: Number(amount), referenceNumber: referenceNumber || null }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo confirmar el depósito.");
      toast.success("Depósito confirmado.");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo confirmar el depósito.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Confirmar depósito — {account.bankName} · {account.accountAlias}</h3>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} icon={<X className="h-4 w-4" />}>Cerrar</Button>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Monto</label>
          <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Referencia (opcional)</label>
          <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
        </div>
        <Button type="submit" variant="success" loading={saving} className="w-full" icon={<Check className="h-4 w-4" />}>Confirmar</Button>
      </form>
    </div>
  );
}
