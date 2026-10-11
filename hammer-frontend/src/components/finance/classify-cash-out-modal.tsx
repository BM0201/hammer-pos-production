"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { showToast } from "@/components/ui/toast";
import { money, fmtDateTime } from "@/lib/format";
import { CATEGORY_LABELS, CATEGORIES } from "@/components/expenses/expense-manager.types";

type UnclassifiedCashOutRow = {
  id: string;
  amount: number;
  reason: string;
  createdAt: string;
  branchCode: string | null;
  branchName: string | null;
  createdByName: string | null;
};

type ExpenseConceptOption = { id: string; name: string; category: string };

/**
 * prompt-gastos-semana-quincena.md Fase 4 — Master clasifica retiros
 * (CASH_OUT) sin clasificar del período: cada uno pasa a ser un gasto real
 * (liga un OperatingExpense, cambia a EXPENSE_OUT) o se marca "No es gasto"
 * (reviewedAt) para que la alerta no lo vuelva a mostrar.
 */
export function ClassifyCashOutModal({
  start, end, branchId, onClose, onChanged,
}: { start: string; end: string; branchId: string | null; onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<UnclassifiedCashOutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [concepts, setConcepts] = useState<ExpenseConceptOption[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState({ category: CATEGORIES[0], conceptId: "", payee: "", receiptNumber: "" });
  const [dismissNote, setDismissNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ start, end });
      if (branchId) params.set("branchId", branchId);
      const res = await apiFetch(`/api/master/finance/cash-out?${params.toString()}`);
      const raw = await res.json();
      if (!res.ok) {
        showToast("error", raw?.error?.message ?? "No se pudieron cargar los retiros.");
        return;
      }
      setRows((unwrapApiData(raw) as UnclassifiedCashOutRow[]) ?? []);
    } catch {
      showToast("error", "Error de red al cargar los retiros.");
    } finally {
      setLoading(false);
    }
  }, [start, end, branchId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    apiFetch(`/api/master/finance/expense-concepts?category=${form.category}`)
      .then((r) => r.json())
      .then((raw) => setConcepts((unwrapApiData(raw) as ExpenseConceptOption[]) ?? []))
      .catch(() => setConcepts([]));
  }, [form.category]);

  function openRow(row: UnclassifiedCashOutRow) {
    setActiveId(row.id);
    setForm({ category: CATEGORIES[0], conceptId: "", payee: "", receiptNumber: "" });
    setDismissNote("");
  }

  async function classify(id: string) {
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/master/finance/cash-out/${id}/classify`, {
        method: "POST",
        body: JSON.stringify({
          category: form.category,
          conceptId: form.conceptId || undefined,
          payee: form.payee.trim() || undefined,
          receiptNumber: form.receiptNumber.trim() || undefined,
        }),
      });
      const raw = await res.json();
      if (!res.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo clasificar.");
        return;
      }
      showToast("success", "Retiro clasificado como gasto.");
      setActiveId(null);
      await load();
      onChanged();
    } catch {
      showToast("error", "Error de red al clasificar.");
    } finally {
      setSubmitting(false);
    }
  }

  async function dismiss(id: string) {
    if (dismissNote.trim().length < 3) {
      showToast("error", "Escribe un motivo (mínimo 3 caracteres).");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/master/finance/cash-out/${id}/dismiss`, {
        method: "POST",
        body: JSON.stringify({ note: dismissNote.trim() }),
      });
      const raw = await res.json();
      if (!res.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo marcar.");
        return;
      }
      showToast("success", "Marcado como 'No es gasto'.");
      setActiveId(null);
      await load();
      onChanged();
    } catch {
      showToast("error", "Error de red al marcar.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Clasificar retiros (CASH_OUT) sin clasificar</h3>
          <button onClick={onClose} aria-label="Cerrar" className="hm-icon-btn"><X className="h-4 w-4" /></button>
        </div>

        {loading ? (
          <div className="py-6 text-center text-xs text-[var(--color-text-muted)]">Cargando…</div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-[var(--color-text-muted)]">No hay retiros sin clasificar en este período.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id} className="rounded-lg p-3" style={{ border: "0.5px solid var(--color-border)" }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)] truncate">{row.reason}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {row.branchCode ?? "—"} · {fmtDateTime(row.createdAt)} · {row.createdByName ?? "Sistema"}
                    </p>
                  </div>
                  <span className="text-sm font-bold tabular-nums">{money(row.amount)}</span>
                </div>

                {activeId !== row.id ? (
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => openRow(row)}>Clasificar</Button>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1 text-xs">
                        <span className="font-medium text-[var(--color-text-secondary)]">Categoría</span>
                        <select className="hm-input h-8 text-xs" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value, conceptId: "" }))}>
                          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs">
                        <span className="font-medium text-[var(--color-text-secondary)]">Concepto (opcional)</span>
                        <select className="hm-input h-8 text-xs" value={form.conceptId} onChange={(e) => setForm((f) => ({ ...f, conceptId: e.target.value }))}>
                          <option value="">Sin concepto específico</option>
                          {concepts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs">
                        <span className="font-medium text-[var(--color-text-secondary)]">Beneficiario</span>
                        <input className="hm-input h-8 text-xs" value={form.payee} onChange={(e) => setForm((f) => ({ ...f, payee: e.target.value }))} />
                      </label>
                      <label className="grid gap-1 text-xs">
                        <span className="font-medium text-[var(--color-text-secondary)]">N° de recibo</span>
                        <input className="hm-input h-8 text-xs" value={form.receiptNumber} onChange={(e) => setForm((f) => ({ ...f, receiptNumber: e.target.value }))} />
                      </label>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Button size="sm" onClick={() => void classify(row.id)} disabled={submitting} icon={submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}>
                        Sí es un gasto — guardar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setActiveId(null)}>Cancelar</Button>
                    </div>
                    <div className="pt-2" style={{ borderTop: "0.5px solid var(--color-border)" }}>
                      <label className="grid gap-1 text-xs">
                        <span className="font-medium text-[var(--color-text-secondary)]">O: no es un gasto — motivo</span>
                        <div className="flex gap-2">
                          <input className="hm-input h-8 text-xs flex-1" placeholder="Ej. retiro del dueño, confirmado" value={dismissNote} onChange={(e) => setDismissNote(e.target.value)} />
                          <Button variant="danger" size="sm" onClick={() => void dismiss(row.id)} disabled={submitting}>No es gasto</Button>
                        </div>
                      </label>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </div>
  );
}
