"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Plus, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { showToast } from "@/components/ui/toast";
import { CATEGORY_LABELS, CATEGORIES } from "@/components/expenses/expense-manager.types";
import type { ExpenseConceptRow } from "@/components/finance/expenses-period.types";

/**
 * prompt-gastos-semana-quincena.md Fase 3 — administrar los ExpenseConcept
 * (el desglose "Agua"/"Internet" dentro de una categoría como UTILITIES):
 * agregar, renombrar, activar/desactivar y reordenar dentro de su categoría.
 */
export function ExpenseConceptsModal({ onClose }: { onClose: () => void }) {
  const [concepts, setConcepts] = useState<ExpenseConceptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCategory, setNewCategory] = useState(CATEGORIES[0]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/master/finance/expense-concepts?includeInactive=true");
      const raw = await res.json();
      if (!res.ok) {
        showToast("error", raw?.error?.message ?? "No se pudieron cargar los conceptos.");
        return;
      }
      setConcepts((unwrapApiData(raw) as ExpenseConceptRow[]) ?? []);
    } catch {
      showToast("error", "Error de red al cargar los conceptos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await apiFetch("/api/master/finance/expense-concepts", {
        method: "POST",
        body: JSON.stringify({ category: newCategory, name }),
      });
      const raw = await res.json();
      if (!res.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo crear el concepto.");
        return;
      }
      setNewName("");
      await load();
      showToast("success", "Concepto agregado.");
    } catch {
      showToast("error", "Error de red al crear el concepto.");
    } finally {
      setCreating(false);
    }
  }

  async function patchConcept(id: string, data: Partial<{ name: string; isActive: boolean; sortOrder: number }>) {
    setSavingId(id);
    try {
      const res = await apiFetch(`/api/master/finance/expense-concepts/${id}`, { method: "PATCH", body: JSON.stringify(data) });
      const raw = await res.json();
      if (!res.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo guardar el cambio.");
        return;
      }
      await load();
    } catch {
      showToast("error", "Error de red al guardar el cambio.");
    } finally {
      setSavingId(null);
    }
  }

  function move(category: string, index: number, direction: -1 | 1) {
    const inCategory = concepts.filter((c) => c.category === category).sort((a, b) => a.sortOrder - b.sortOrder);
    const target = inCategory[index + direction];
    const current = inCategory[index];
    if (!target || !current) return;
    void patchConcept(current.id, { sortOrder: target.sortOrder });
    void patchConcept(target.id, { sortOrder: current.sortOrder });
  }

  const byCategory = CATEGORIES.map((category) => ({
    category,
    items: concepts.filter((c) => c.category === category).sort((a, b) => a.sortOrder - b.sortOrder),
  })).filter((g) => g.items.length > 0 || g.category === newCategory);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Conceptos de gasto</h3>
          <button onClick={onClose} aria-label="Cerrar" className="hm-icon-btn"><X className="h-4 w-4" /></button>
        </div>

        {/* Agregar */}
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[10rem]">
            <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Categoría</label>
            <select className="hm-input h-9 text-sm w-full" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[12rem]">
            <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Nombre del concepto</label>
            <input className="hm-input h-9 text-sm w-full" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ej. Internet" />
          </div>
          <Button size="sm" onClick={() => void handleCreate()} disabled={creating || !newName.trim()} icon={creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}>
            Agregar
          </Button>
        </div>

        {loading ? (
          <div className="py-6 text-center text-xs text-[var(--color-text-muted)]">Cargando…</div>
        ) : (
          <div className="space-y-4">
            {byCategory.map((group) => (
              <div key={group.category}>
                <p className="text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--color-text-muted)" }}>
                  {CATEGORY_LABELS[group.category] ?? group.category}
                </p>
                {group.items.length === 0 ? (
                  <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Sin conceptos todavía.</p>
                ) : (
                  <ul className="space-y-1">
                    {group.items.map((concept, idx) => (
                      <li key={concept.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ border: "0.5px solid var(--color-border)", opacity: concept.isActive ? 1 : 0.5 }}>
                        <div className="flex flex-col">
                          <button disabled={idx === 0} onClick={() => move(group.category, idx, -1)} className="disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
                          <button disabled={idx === group.items.length - 1} onClick={() => move(group.category, idx, 1)} className="disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
                        </div>
                        <input
                          className="hm-input h-8 text-sm flex-1"
                          defaultValue={concept.name}
                          onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== concept.name) void patchConcept(concept.id, { name: e.target.value.trim() }); }}
                        />
                        <button
                          onClick={() => void patchConcept(concept.id, { isActive: !concept.isActive })}
                          disabled={savingId === concept.id}
                          className="text-xs font-medium hover:underline whitespace-nowrap"
                          style={{ color: concept.isActive ? "var(--color-text-muted)" : "var(--color-success-700)" }}
                        >
                          {concept.isActive ? "Desactivar" : "Activar"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </div>
  );
}
