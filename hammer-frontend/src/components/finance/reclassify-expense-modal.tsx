"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { showToast } from "@/components/ui/toast";
import { money, fmtDateTime } from "@/lib/format";
import { CATEGORY_LABELS, CATEGORIES } from "@/components/expenses/expense-manager.types";

type ReviewRow = { id: string; amount: string | number; description: string; effectiveFrom: string; payee: string | null };
type ExpenseConceptOption = { id: string; name: string; category: string };

/**
 * prompt-caja-gastos-pos-cobro.md Commit 3 — "Reclasificar" (en cada gasto
 * de Otros, uno por uno o "Revisar N gastos en Otros" en lote). Nunca
 * cambia monto/fecha/movimiento de caja — solo categoría/concepto, o
 * convierte el gasto en CashPurchase ("Era una compra de mercadería").
 * Modo "single" precarga una sola fila (el botón por fila de la tabla);
 * "bulk" carga todas las OTHER del período (el aviso de arriba de la
 * tabla).
 */
export function ReclassifyExpenseModal({
  mode, singleRow, start, end, branchId, onClose, onChanged,
}: {
  mode: "single" | "bulk";
  singleRow?: { id: string; amount: number; description: string; effectiveFrom: string };
  start: string;
  end: string;
  branchId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<ReviewRow[]>(singleRow ? [{ ...singleRow, payee: null }] : []);
  const [loading, setLoading] = useState(mode === "bulk");
  const [concepts, setConcepts] = useState<ExpenseConceptOption[]>([]);
  const [forms, setForms] = useState<Record<string, { category: string; conceptId: string; mode: "RECLASSIFY" | "PURCHASE"; kind: "GOODS" | "FREIGHT"; supplierName: string }>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (mode === "single") return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ start, end });
      if (branchId) params.set("branchId", branchId);
      const res = await apiFetch(`/api/master/finance/expenses/other-for-review?${params.toString()}`);
      const raw = await res.json();
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudieron cargar los gastos."); return; }
      setRows((unwrapApiData(raw) as ReviewRow[]) ?? []);
    } catch {
      showToast("error", "Error de red.");
    } finally {
      setLoading(false);
    }
  }, [mode, start, end, branchId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    apiFetch(`/api/master/finance/expense-concepts?category=${CATEGORIES[0]}`)
      .then((r) => r.json())
      .then((raw) => setConcepts((unwrapApiData(raw) as ExpenseConceptOption[]) ?? []))
      .catch(() => setConcepts([]));
  }, []);

  function formFor(id: string) {
    return forms[id] ?? { category: CATEGORIES[0], conceptId: "", mode: "RECLASSIFY" as const, kind: "GOODS" as const, supplierName: "" };
  }
  function setForm(id: string, patch: Partial<ReturnType<typeof formFor>>) {
    setForms((f) => ({ ...f, [id]: { ...formFor(id), ...patch } }));
  }

  async function loadConceptsFor(category: string) {
    const res = await apiFetch(`/api/master/finance/expense-concepts?category=${category}`);
    const raw = await res.json();
    setConcepts((unwrapApiData(raw) as ExpenseConceptOption[]) ?? []);
  }

  async function apply(row: ReviewRow) {
    const form = formFor(row.id);
    setSubmittingId(row.id);
    try {
      const res = form.mode === "PURCHASE"
        ? await apiFetch(`/api/master/finance/expenses/${row.id}/convert-to-purchase`, {
            method: "POST",
            body: JSON.stringify({ kind: form.kind, supplierName: form.supplierName.trim() || undefined }),
          })
        : await apiFetch(`/api/master/finance/expenses/${row.id}/reclassify`, {
            method: "POST",
            body: JSON.stringify({ category: form.category, conceptId: form.conceptId || undefined }),
          });
      const raw = await res.json();
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo aplicar."); return; }
      showToast("success", form.mode === "PURCHASE" ? "Convertido en compra — salió del gasto operativo." : "Gasto reclasificado.");
      setRows((r) => r.filter((x) => x.id !== row.id));
      onChanged();
    } catch {
      showToast("error", "Error de red.");
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[85vh] overflow-y-auto space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            {mode === "single" ? "Reclasificar gasto" : `Revisar ${rows.length} gasto${rows.length === 1 ? "" : "s"} en Otros`}
          </h3>
          <button onClick={onClose} aria-label="Cerrar" className="hm-icon-btn"><X className="h-4 w-4" /></button>
        </div>

        {loading ? (
          <div className="py-6 text-center text-xs text-[var(--color-text-muted)]">Cargando…</div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-[var(--color-text-muted)]">Nada pendiente de revisar.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => {
              const form = formFor(row.id);
              const submitting = submittingId === row.id;
              return (
                <li key={row.id} className="rounded-lg p-3 space-y-2" style={{ border: "0.5px solid var(--color-border)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text)] truncate">{row.description}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{fmtDateTime(row.effectiveFrom)}{row.payee ? ` · ${row.payee}` : ""}</p>
                    </div>
                    <span className="text-sm font-bold tabular-nums">{money(Number(row.amount))}</span>
                  </div>

                  <div className="flex gap-2 text-xs">
                    <button type="button" onClick={() => setForm(row.id, { mode: "RECLASSIFY" })} className={`rounded-full px-2.5 py-1 font-semibold ${form.mode === "RECLASSIFY" ? "bg-[var(--color-master-100)] text-[var(--color-master-700)]" : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"}`}>
                      Es un gasto
                    </button>
                    <button type="button" onClick={() => setForm(row.id, { mode: "PURCHASE" })} className={`rounded-full px-2.5 py-1 font-semibold ${form.mode === "PURCHASE" ? "bg-[var(--color-master-100)] text-[var(--color-master-700)]" : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"}`}>
                      Era una compra de mercadería
                    </button>
                  </div>

                  {form.mode === "RECLASSIFY" ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1 text-xs">
                        <span className="font-medium text-[var(--color-text-secondary)]">Categoría</span>
                        <select
                          className="hm-input h-8 text-xs"
                          value={form.category}
                          onChange={(e) => { setForm(row.id, { category: e.target.value, conceptId: "" }); void loadConceptsFor(e.target.value); }}
                        >
                          {CATEGORIES.filter((c) => c !== "PAYROLL").map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs">
                        <span className="font-medium text-[var(--color-text-secondary)]">Concepto (opcional)</span>
                        <select className="hm-input h-8 text-xs" value={form.conceptId} onChange={(e) => setForm(row.id, { conceptId: e.target.value })}>
                          <option value="">Sin concepto específico</option>
                          {concepts.filter((c) => c.category === form.category).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </label>
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1 text-xs">
                        <span className="font-medium text-[var(--color-text-secondary)]">Tipo</span>
                        <select className="hm-input h-8 text-xs" value={form.kind} onChange={(e) => setForm(row.id, { kind: e.target.value as "GOODS" | "FREIGHT" })}>
                          <option value="GOODS">Mercadería</option>
                          <option value="FREIGHT">Flete</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs">
                        <span className="font-medium text-[var(--color-text-secondary)]">Proveedor (opcional)</span>
                        <input className="hm-input h-8 text-xs" value={form.supplierName} onChange={(e) => setForm(row.id, { supplierName: e.target.value })} />
                      </label>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => void apply(row)} disabled={submitting} icon={submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}>
                      Aplicar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </div>
  );
}
