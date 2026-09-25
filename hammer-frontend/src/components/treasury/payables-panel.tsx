"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, ChevronDown, ChevronUp, Landmark, RefreshCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, fmtDate } from "@/lib/format";

/**
 * Fase 4 (prompt-cxp.md) — "Por pagar": por proveedor, saldo total y
 * detalle por orden con vencimiento. Solo se monta cuando el usuario
 * expande esta sección (next/dynamic en la página, ver master/treasury/page.tsx)
 * — mismo criterio que el resto de los paneles pesados de esta página tras
 * la Fase 5 de rendimiento de esta sesión.
 */

type SupplierPayableOrder = {
  purchaseOrderId: string;
  orderNumber: string;
  debt: number;
  paid: number;
  balance: number;
  dueDate: string | null;
  daysOverdue: number | null;
};
type SupplierPayableSummary = {
  supplierId: string;
  supplierName: string;
  totalDebt: number;
  totalPaid: number;
  totalBalance: number;
  orders: SupplierPayableOrder[];
};

export function PayablesPanel() {
  const [payables, setPayables] = useState<SupplierPayableSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSupplierId, setExpandedSupplierId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch("/api/master/treasury/payables?onlyOpen=true");
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar cuentas por pagar.");
      setPayables(unwrapApiData(raw) as SupplierPayableSummary[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar cuentas por pagar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const totalOwed = (payables ?? []).reduce((s, p) => s + p.totalBalance, 0);
  const overdueSuppliers = (payables ?? []).filter((p) => p.orders.some((o) => (o.daysOverdue ?? 0) > 0)).length;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Landmark className="h-4 w-4 text-[var(--color-master-600)]" />
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Por pagar</h2>
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => void load()} icon={<RefreshCcw className="h-3.5 w-3.5" />}>
          Actualizar
        </Button>
      </div>

      {loading && !payables ? (
        <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">Cargando…</p>
      ) : !payables || payables.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">Sin deudas pendientes con proveedores.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-[var(--color-surface-muted)] p-3 text-sm">
            <span className="text-[var(--color-text-secondary)]">Total adeudado</span>
            <span className="hm-num text-base font-bold text-[var(--color-text)]">{money(totalOwed)}</span>
            {overdueSuppliers > 0 && (
              <span className="ml-auto flex items-center gap-1 rounded-full bg-[var(--color-danger-100)] px-2.5 py-1 text-xs font-semibold text-[var(--color-danger-700)]">
                <AlertTriangle className="h-3.5 w-3.5" /> {overdueSuppliers} proveedor{overdueSuppliers !== 1 ? "es" : ""} con órdenes vencidas
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            {payables.map((p) => {
              const expanded = expandedSupplierId === p.supplierId;
              const hasOverdue = p.orders.some((o) => (o.daysOverdue ?? 0) > 0);
              return (
                <div key={p.supplierId} className="rounded-lg border border-[var(--color-border)]">
                  <button
                    type="button"
                    onClick={() => setExpandedSupplierId(expanded ? null : p.supplierId)}
                    className="flex w-full items-center justify-between gap-3 p-3 text-left"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[var(--color-text)]">{p.supplierName}</span>
                        {hasOverdue && <Badge variant="danger">Vencido</Badge>}
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)]">{p.orders.length} orden{p.orders.length !== 1 ? "es" : ""} pendiente{p.orders.length !== 1 ? "s" : ""}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="hm-num text-base font-bold text-[var(--color-text)]">{money(p.totalBalance)}</span>
                      {expanded ? <ChevronUp className="h-4 w-4 text-[var(--color-text-soft)]" /> : <ChevronDown className="h-4 w-4 text-[var(--color-text-soft)]" />}
                    </div>
                  </button>
                  {expanded && (
                    <div className="border-t border-[var(--color-border)] p-3">
                      <table className="hm-table w-full text-xs">
                        <thead>
                          <tr><th>Orden</th><th className="text-right">Deuda</th><th className="text-right">Pagado</th><th className="text-right">Saldo</th><th>Vence</th></tr>
                        </thead>
                        <tbody>
                          {p.orders.map((o) => (
                            <tr key={o.purchaseOrderId}>
                              <td className="font-mono">{o.orderNumber}</td>
                              <td className="text-right font-mono">{money(o.debt)}</td>
                              <td className="text-right font-mono text-[var(--color-success-700)]">{money(o.paid)}</td>
                              <td className="text-right font-mono font-semibold">{money(o.balance)}</td>
                              <td className="whitespace-nowrap">
                                {o.dueDate ? fmtDate(o.dueDate) : "—"}
                                {(o.daysOverdue ?? 0) > 0 && (
                                  <span className="ml-1.5 rounded-full bg-[var(--color-danger-100)] px-1.5 py-0.5 text-[0.6875rem] font-semibold text-[var(--color-danger-700)]">
                                    +{o.daysOverdue}d
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
