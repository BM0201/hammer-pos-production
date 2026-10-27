"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { X, Plus, Pencil, Trash2, ChevronDown, ChevronUp, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, fmtDayMonthUTC } from "@/lib/format";
import {
  type Branch,
  type ExpenseSummary,
  CATEGORY_LABELS,
  CATEGORIES,
} from "@/components/expenses/expense-manager.types";

/** Historial por categoría (GET /api/finance/expense-history). */
type CategoryHistory = {
  category: string;
  last: { amount: number; date: string; description: string } | null;
  monthlyAverage: number;
  suggestedBudget: number;
};

// PAYROLL se sincroniza solo al postear la nómina — presupuestarlo a mano lo duplicaría.
const BUDGET_CATEGORIES = CATEGORIES.filter((c) => c !== "PAYROLL");

/**
 * Presupuesto mensual por sucursal y categoría. El presupuesto son los gastos
 * fijos mensuales (OperatingExpense) que el libro por período prorratea en la
 * columna "Presupuesto"; el sugerido sale de lo pagado los últimos 6 meses.
 * Reemplaza la "vista clásica por mes" que vivía debajo del libro.
 */
export function BudgetModal({
  branches,
  initialBranchId,
  initialCategory,
  initialAdd,
  onClose,
  onChanged,
}: {
  branches: Branch[];
  initialBranchId: string | null;
  /** Categoría abierta al entrar. */
  initialCategory: string | null;
  /** Con el formulario de alta listo en esa categoría ("Definir"). */
  initialAdd: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [branchId, setBranchId] = useState(initialBranchId ?? branches[0]?.id ?? "");
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [history, setHistory] = useState<Map<string, CategoryHistory>>(new Map());
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(initialCategory);
  const [draft, setDraft] = useState<{ category: string; description: string; amount: string } | null>(() =>
    initialAdd && initialCategory && BUDGET_CATEGORIES.includes(initialCategory)
      ? { category: initialCategory, description: `Presupuesto ${CATEGORY_LABELS[initialCategory] ?? initialCategory}`, amount: "" }
      : null);
  const [editing, setEditing] = useState<{ id: string; description: string; amount: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const [sumRes, histRes] = await Promise.all([
        apiFetch(`/api/expenses?branchId=${branchId}&summary=true`),
        apiFetch(`/api/finance/expense-history?branchId=${branchId}`),
      ]);
      if (!sumRes.ok) throw new Error();
      setSummary(unwrapApiData(await sumRes.json()) as ExpenseSummary);
      const hist = histRes.ok ? (unwrapApiData(await histRes.json()) as { categories?: CategoryHistory[] } | null) : null;
      setHistory(new Map((hist?.categories ?? []).map((c) => [c.category, c])));
    } catch {
      showToast("error", "No se pudo cargar el presupuesto de la sucursal.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { void load(); }, [load]);

  function startDraft(category: string, amount?: number) {
    setExpanded(category);
    setEditing(null);
    setDraft({ category, description: `Presupuesto ${CATEGORY_LABELS[category] ?? category}`, amount: amount ? String(amount) : "" });
  }

  async function mutate(request: () => Promise<Response>, okMessage: string) {
    setSaving(true);
    try {
      const res = await request();
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "No se pudo guardar.");
      }
      showToast("success", okMessage);
      await load();
      onChanged();
      return true;
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "No se pudo guardar.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate() {
    if (!draft) return;
    const amount = parseFloat(draft.amount);
    if (!draft.description.trim() || !(amount > 0)) return showToast("error", "Descripción y un monto mayor a 0 son obligatorios.");
    const ok = await mutate(
      () => apiFetch("/api/expenses", {
        method: "POST",
        body: JSON.stringify({ branchId, category: draft.category, description: draft.description.trim(), amount }),
      }),
      "Presupuesto agregado",
    );
    if (ok) setDraft(null);
  }

  async function handleSaveEdit() {
    if (!editing) return;
    const amount = parseFloat(editing.amount);
    if (!editing.description.trim() || !(amount > 0)) return showToast("error", "Descripción y un monto mayor a 0 son obligatorios.");
    const ok = await mutate(
      () => apiFetch(`/api/expenses/${editing.id}`, { method: "PUT", body: JSON.stringify({ description: editing.description.trim(), amount }) }),
      "Presupuesto actualizado",
    );
    if (ok) setEditing(null);
  }

  async function handleDeactivate(id: string) {
    if (!confirm("¿Quitar este gasto fijo del presupuesto?")) return;
    await mutate(() => apiFetch(`/api/expenses/${id}`, { method: "DELETE" }), "Gasto fijo quitado");
  }

  const total = BUDGET_CATEGORIES.reduce((s, c) => s + (summary?.byCategory[c]?.total ?? 0), 0);
  const suggestedTotal = BUDGET_CATEGORIES.reduce((s, c) => s + (history.get(c)?.suggestedBudget ?? 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] overflow-y-auto space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Presupuesto mensual"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Presupuesto mensual por categoría</h3>
          <div className="flex items-center gap-2">
            <select className="hm-input h-8 text-xs" value={branchId} onChange={(e) => { setBranchId(e.target.value); setDraft(null); setEditing(null); }} aria-label="Sucursal del presupuesto">
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
            <button onClick={onClose} aria-label="Cerrar" className="hm-icon-btn"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          El presupuesto son los gastos fijos de cada mes (alquiler, servicios, etc.) de la sucursal; el libro lo reparte por día, semana o quincena.
          El <b>sugerido</b> sale de lo que de verdad se pagó los últimos 6 meses. La nómina no va aquí: se toma de la planilla.
        </p>

        {loading && !summary ? (
          <div className="py-6 text-center text-xs text-[var(--color-text-muted)]">Cargando…</div>
        ) : (
          <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="py-1.5 pr-3">Categoría</th>
                  <th className="py-1.5 pr-3 text-right">Presupuesto</th>
                  <th className="py-1.5 pr-3 text-right">Sugerido</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {BUDGET_CATEGORIES.map((category) => {
                  const data = summary?.byCategory[category];
                  const hist = history.get(category);
                  const isOpen = expanded === category;
                  return (
                    <Fragment key={category}>
                      <tr className="cursor-pointer hover:bg-[var(--color-surface-alt)]" onClick={() => setExpanded(isOpen ? null : category)}>
                        <td className="py-2 pr-3 font-semibold text-[var(--color-text)]">
                          <span className="inline-flex items-center gap-1.5">
                            {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            {CATEGORY_LABELS[category] ?? category}
                            {data && data.count > 1 && <span className="font-normal text-[var(--color-text-muted)]">({data.count})</span>}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right font-bold tabular-nums text-[var(--color-text)]">{data ? money(data.total) : "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-info-700)]" title={hist?.last ? `Último: ${money(hist.last.amount)} el ${fmtDayMonthUTC(hist.last.date)} · ${hist.last.description}` : undefined}>
                          {hist && hist.suggestedBudget > 0 ? money(hist.suggestedBudget) : "—"}
                        </td>
                        <td className="py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          {hist && hist.suggestedBudget > 0 && !data && (
                            <Button size="sm" variant="secondary" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => startDraft(category, hist.suggestedBudget)}>
                              Usar sugerido
                            </Button>
                          )}
                          <button onClick={() => startDraft(category)} className="ml-2 text-xs font-medium text-[var(--color-info-700)] hover:underline">
                            <Plus className="inline h-3.5 w-3.5" /> Agregar
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={4} className="bg-[var(--color-surface-alt)] px-3 py-2">
                            <div className="space-y-1.5">
                              {(data?.items ?? []).map((exp) => editing?.id === exp.id ? (
                                <div key={exp.id} className="flex flex-wrap items-center gap-2">
                                  <input className="hm-input h-8 min-w-[12rem] flex-1 text-xs" aria-label="Descripción" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                                  <input className="hm-input h-8 w-32 text-xs" type="number" min="0" step="0.01" aria-label="Monto mensual (C$)" value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} />
                                  <Button size="sm" onClick={() => void handleSaveEdit()} disabled={saving}>Guardar</Button>
                                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button>
                                </div>
                              ) : (
                                <div key={exp.id} className="flex items-center justify-between gap-2">
                                  <span className="text-[var(--color-text)]">{exp.description}</span>
                                  <span className="flex items-center gap-1">
                                    <b className="tabular-nums text-[var(--color-text)]">{money(Number(exp.amount))}</b>
                                    <button className="hm-icon-btn" title="Editar" aria-label="Editar" onClick={() => { setDraft(null); setEditing({ id: exp.id, description: exp.description, amount: String(Number(exp.amount)) }); }}>
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button className="hm-icon-btn text-[var(--color-danger-600)]" title="Quitar" aria-label="Quitar" onClick={() => void handleDeactivate(exp.id)} disabled={saving}>
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </span>
                                </div>
                              ))}
                              {!data?.items.length && draft?.category !== category && (
                                <p className="text-[var(--color-text-muted)]">Sin presupuesto. Usa “Agregar” o “Usar sugerido”.</p>
                              )}
                              {draft?.category === category && (
                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                  <input className="hm-input h-8 min-w-[12rem] flex-1 text-xs" aria-label="Descripción" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                                  <input className="hm-input h-8 w-32 text-xs" type="number" min="0" step="0.01" placeholder={hist && hist.suggestedBudget > 0 ? `Sugerido ${money(hist.suggestedBudget)}` : "Monto mensual"} aria-label="Monto mensual (C$)" autoFocus value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
                                  <Button size="sm" onClick={() => void handleCreate()} disabled={saving} icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}>Agregar</Button>
                                  <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>Cancelar</Button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--color-border)] font-bold text-[var(--color-text)]">
                  <td className="py-2 pr-3">Total mensual</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(total)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-info-700)]">{suggestedTotal > 0 ? money(suggestedTotal) : "—"}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </div>
  );
}
