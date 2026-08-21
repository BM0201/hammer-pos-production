"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Receipt, Undo2, X, ExternalLink } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import toast from "react-hot-toast";

const fmt = (v: number) => `C$${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  PAYROLL: "Personal / Nómina",
  UTILITIES: "Servicios",
  RENT: "Renta",
  FOOD: "Alimentación",
  MAINTENANCE: "Mantenimiento",
  TRANSPORT: "Transporte",
  MARKETING: "Mercadeo",
  TAXES: "Impuestos",
  OTHER: "Otro",
};

type RetainedCashExpenseRow = {
  treasuryEntryId: string;
  expenseId: string;
  amount: string;
  occurredAt: string;
  receiptReference: string | null;
  category: string;
  description: string;
  isActive: boolean;
};

/**
 * prompt-tesoreria-gasto-retenido-y-techo.md T-6/R-1 — solo los gastos
 * pagados con efectivo retenido (los que mueven la barra), no una tercera
 * pantalla de gastos. El pie muestra el total que bajó del acumulado en el
 * período; el enlace va al gestor de gastos existente para todo lo demás.
 */
export function RetainedCashExpenseList({ branchId, refreshKey }: { branchId: string; refreshKey: number }) {
  const [rows, setRows] = useState<RetainedCashExpenseRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [voiding, setVoiding] = useState<RetainedCashExpenseRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/master/treasury/retained-cash-expenses?branchId=${branchId}`);
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudieron cargar los gastos.");
      setRows(unwrapApiData(raw) as RetainedCashExpenseRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar los gastos.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const activeRows = (rows ?? []).filter((r) => r.isActive);
  const total = activeRows.reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-[var(--color-master-600)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Gastos pagados con efectivo retenido</h2>
        </div>
        <Link href="/app/master/finance" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-master-600)] hover:underline">
          Ver todos los gastos <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">Cargando…</p>
      ) : activeRows.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">Sin gastos pagados con efectivo retenido todavía.</p>
      ) : (
        <>
          <div className="space-y-1.5">
            {activeRows.map((row) => (
              <div key={row.treasuryEntryId} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--color-text)]">{row.description}</span>
                    <span className="hm-chip">{EXPENSE_CATEGORY_LABELS[row.category] ?? row.category}</span>
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {new Date(row.occurredAt).toLocaleDateString("es-NI", { day: "2-digit", month: "short", year: "numeric" })}
                    {row.receiptReference ? ` · ${row.receiptReference}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-sm font-bold tabular-nums text-[var(--color-danger-600)]">−{fmt(Number(row.amount))}</span>
                  <Button variant="ghost" size="sm" onClick={() => setVoiding(row)} icon={<Undo2 className="h-3.5 w-3.5" />}>Anular</Button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-[var(--color-border)] pt-2.5 text-sm">
            <span className="text-[var(--color-text-muted)]">Total bajado del acumulado</span>
            <span className="font-mono font-bold tabular-nums text-[var(--color-text)]">{fmt(total)}</span>
          </div>
        </>
      )}

      {voiding && (
        <VoidExpenseModal
          row={voiding}
          onClose={() => setVoiding(null)}
          onVoided={() => { setVoiding(null); void load(); }}
        />
      )}
    </Card>
  );
}

function VoidExpenseModal({ row, onClose, onVoided }: { row: RetainedCashExpenseRow; onClose: () => void; onVoided: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const reasonOk = reason.trim().length >= 10;

  async function submit() {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/master/treasury/retained-cash-expenses/${row.expenseId}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo anular el gasto.");
      toast.success("Gasto anulado. El acumulado subió por el mismo monto.");
      onVoided();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo anular el gasto.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm space-y-3 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Anular gasto</h3>
          <Button variant="ghost" size="sm" onClick={onClose} icon={<X className="h-4 w-4" />}>Cerrar</Button>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          {row.description} · <span className="font-semibold">{fmt(Number(row.amount))}</span>. No se borra nada — se escribe un asiento inverso y el acumulado vuelve a subir.
        </p>
        <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
          Razón de anulación (mínimo 10 caracteres)
          <textarea
            className="hm-input mt-1 min-h-[4.5rem] w-full resize-none rounded-lg px-3 py-2 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Por qué se anula este gasto…"
          />
        </label>
        <Button variant="danger" loading={saving} disabled={!reasonOk} onClick={() => void submit()} className="w-full">Anular</Button>
      </div>
    </div>
  );
}
