"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Landmark, RefreshCcw, AlertTriangle, ArrowRight } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import toast from "react-hot-toast";

type Branch = { id: string; code: string; name: string };

type TreasuryAccountBalance = { balance: number; pendingOpening: boolean };

type TreasuryAccountRow = {
  id: string;
  type: "BANK" | "SETTLEMENT" | "CUSTODY" | "SAFE";
  bankName: string;
  accountAlias: string;
  accountNumber: string;
  currencyCode: string;
  branchId: string | null;
  owner: string | null;
  balance: TreasuryAccountBalance;
};

type ExposureStatus = {
  outstandingAmount: number;
  oldestOutstandingDate: string | null;
  businessDaysWithoutDeposit: number;
  alert: { exceeds: boolean };
};

/**
 * Vista resumida de Bancos y efectivo, embebida en Finanzas — el libro
 * mayor completo (posición, detalle con saldo corriente, confirmar
 * depósitos) vive en Tesorería (prompt-libro-mayor-tesoreria.md §6); acá
 * solo se resume y se linkea, para no mantener dos flujos de confirmación
 * en paralelo que puedan desincronizarse.
 */
export function BanksTreasuryPanel() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [accounts, setAccounts] = useState<TreasuryAccountRow[]>([]);
  const [exposure, setExposure] = useState<ExposureStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const branchesRes = await apiFetch("/api/master/branches");
      const branchesRaw = await branchesRes.json();
      if (!branchesRes.ok) throw new Error(branchesRaw?.error?.message ?? "No se pudieron cargar las sucursales.");
      setBranches(unwrapApiData(branchesRaw) as Branch[]);

      const accountsRes = await apiFetch("/api/master/treasury/bank-accounts/with-balances");
      const accountsRaw = await accountsRes.json();
      if (!accountsRes.ok) throw new Error(accountsRaw?.error?.message ?? "No se pudieron cargar las cuentas.");
      setAccounts((unwrapApiData(accountsRaw) as TreasuryAccountRow[]).filter((a) => a.type === "BANK"));
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
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" loading={loading} onClick={() => void load()} icon={<RefreshCcw className="h-3.5 w-3.5" />}>Actualizar</Button>
          <Link href="/app/master/treasury">
            <Button variant="secondary" size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />}>Abrir Tesorería completa</Button>
          </Link>
        </div>
      </div>

      {/* Saldo real por cuenta (libro mayor) */}
      <Card className="p-4">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Saldo por cuenta</h3>
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">Calculado del libro mayor de Tesorería — apertura declarada + entradas − salidas. &quot;Esperado&quot;: Hammer no se conecta al banco.</p>
        {accounts.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">Sin cuentas registradas. Agrégalas desde Tesorería.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="hm-table w-full">
              <thead>
                <tr><th>Cuenta</th><th>Sucursal</th><th className="text-right">Saldo</th></tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="font-medium">{a.bankName}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{a.owner ?? a.accountAlias} · {a.accountNumber}</div>
                    </td>
                    <td className="text-xs">{branchName(a.branchId)}</td>
                    <td className="text-right font-mono text-sm font-semibold">
                      {a.balance.pendingOpening ? (
                        <span className="text-xs font-semibold text-[var(--color-warning-600)]">Pendiente de apertura</span>
                      ) : (
                        `${a.currencyCode === "USD" ? "$" : "C$"} ${a.balance.balance.toFixed(2)}`
                      )}
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
    </div>
  );
}
