"use client";

import { useCallback, useEffect, useState } from "react";
import { Landmark, Plus, X, Check, RefreshCcw, PiggyBank } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";

type Branch = { id: string; code: string; name: string; cashFundAmount: string | null };

type BankAccount = {
  id: string;
  bankName: string;
  accountAlias: string;
  accountNumber: string;
  currency: string;
  branchId: string | null;
  isActive: boolean;
  owner: string | null;
  acceptsCustomerPayments: boolean;
};

/**
 * correccion-destino-y-pantalla-cobro.md §5: "son varias, editable solo por
 * Master" (cuentas bancarias) + "fondo de caja: lo que la sesión debería
 * poder abrir al día siguiente" (por sucursal, §1.1).
 */
export default function TreasuryPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddAccount, setShowAddAccount] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [branchesRes, accountsRes] = await Promise.all([
        apiFetch("/api/master/branches"),
        apiFetch("/api/master/treasury/bank-accounts"),
      ]);
      const branchesRaw = await branchesRes.json();
      const accountsRaw = await accountsRes.json();
      if (!branchesRes.ok) throw new Error(branchesRaw?.error?.message ?? "No se pudieron cargar las sucursales.");
      if (!accountsRes.ok) throw new Error(accountsRaw?.error?.message ?? "No se pudieron cargar las cuentas.");
      setBranches(unwrapApiData(branchesRaw) as Branch[]);
      setAccounts(unwrapApiData(accountsRaw) as BankAccount[]);
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

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-1 rounded-full" style={{ background: "var(--color-master-600)" }} />
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-text)]">Tesorería</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Cuentas bancarias y fondo de caja por sucursal — editable solo por Master.</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" loading={loading} onClick={() => void load()} icon={<RefreshCcw className="h-3.5 w-3.5" />}>Actualizar</Button>
      </div>

      {/* Fondo de caja por sucursal */}
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

      {/* Cuentas bancarias */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-[var(--color-master-600)]" />
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Cuentas bancarias</h2>
          </div>
          <Button variant="success" size="sm" onClick={() => setShowAddAccount(true)} icon={<Plus className="h-3.5 w-3.5" />}>Agregar cuenta</Button>
        </div>
        {accounts.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">Sin cuentas registradas todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="hm-table w-full">
              <thead>
                <tr><th>Banco</th><th>Titular</th><th>Alias</th><th>Número</th><th>Moneda</th><th>Sucursal</th><th>Estado</th><th>Pagos de clientes</th><th></th></tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.bankName}</td>
                    <td className="text-xs text-[var(--color-text-muted)]">{a.owner ?? "—"}</td>
                    <td>{a.accountAlias}</td>
                    <td className="font-mono text-xs">{a.accountNumber}</td>
                    <td>{a.currency}</td>
                    <td>{branchName(a.branchId)}</td>
                    <td><Badge variant={a.isActive ? "success" : "neutral"}>{a.isActive ? "Activa" : "Inactiva"}</Badge></td>
                    <td>
                      <button
                        type="button"
                        onClick={() => void toggleAcceptsCustomerPayments(a)}
                        className="text-left"
                        title="Si está apagado, esta cuenta no aparece en el selector de cobro por transferencia."
                      >
                        <Badge variant={a.acceptsCustomerPayments ? "success" : "neutral"}>
                          {a.acceptsCustomerPayments ? "Acepta" : "No acepta"}
                        </Badge>
                      </button>
                    </td>
                    <td>
                      <Button variant="ghost" size="sm" onClick={() => void toggleAccountActive(a)}>
                        {a.isActive ? "Desactivar" : "Reactivar"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showAddAccount && (
        <AddBankAccountModal
          branches={branches}
          onClose={() => setShowAddAccount(false)}
          onSaved={() => { setShowAddAccount(false); void load(); }}
        />
      )}
    </section>
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

function AddBankAccountModal({ branches, onClose, onSaved }: { branches: Branch[]; onClose: () => void; onSaved: () => void }) {
  const [bankName, setBankName] = useState("");
  const [owner, setOwner] = useState("");
  const [accountAlias, setAccountAlias] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [currency, setCurrency] = useState("NIO");
  const [branchId, setBranchId] = useState<string>("");
  const [acceptsCustomerPayments, setAcceptsCustomerPayments] = useState(true);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch("/api/master/treasury/bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankName, accountAlias, accountNumber, currency,
          branchId: branchId || null,
          owner: owner.trim() || null,
          acceptsCustomerPayments,
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
          <h3 className="text-sm font-semibold">Agregar cuenta bancaria</h3>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} icon={<X className="h-4 w-4" />}>Cerrar</Button>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Banco</label>
          <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="BAC, BANPRO, Lafise…" required />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Titular de la cuenta</label>
          <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Nombre completo, como en el estado de cuenta" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Alias / descripción</label>
          <Input value={accountAlias} onChange={(e) => setAccountAlias(e.target.value)} placeholder="Córdobas Managua" required />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Número de cuenta</label>
          <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Moneda</label>
            <select className="hm-input w-full" value={currency} onChange={(e) => setCurrency(e.target.value)}>
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
        <label className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-muted)]">
          <input type="checkbox" checked={acceptsCustomerPayments} onChange={(e) => setAcceptsCustomerPayments(e.target.checked)} />
          Acepta pagos de clientes (aparece en el cobro por transferencia)
        </label>
        <Button type="submit" variant="success" loading={saving} className="w-full" icon={<Check className="h-4 w-4" />}>Guardar</Button>
      </form>
    </div>
  );
}
