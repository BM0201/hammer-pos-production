"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { type CategoryPolicyRow } from "@/components/expenses/expense-manager.types";

/**
 * Fase 1 (prompt-mudanza-zona-precios.md) — extraído de expense-manager.tsx
 * (antes activeTab === "policies"), sin cambiar comportamiento. Estado propio
 * — branchId llega por props, ya no comparte selectedBranchId con Gastos.
 */
export function CategoryPoliciesPanel({ branchId, onSaved }: { branchId: string; onSaved?: () => void }) {
  const [categoryPolicies, setCategoryPolicies] = useState<CategoryPolicyRow[]>([]);
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, CategoryPolicyRow>>({});

  const loadCategoryPolicies = useCallback(async () => {
    if (!branchId) return;
    try {
      const res = await fetch(`/api/pricing/category-policies?branchId=${branchId}`);
      const data = unwrapApiData(await res.json()) as { policies?: CategoryPolicyRow[] };
      const policies = data.policies ?? [];
      setCategoryPolicies(policies);
      setPolicyDrafts(Object.fromEntries(policies.map((policy) => [policy.categoryId, policy])));
    } catch (e) {
      showToast("error", "No se pudieron cargar politicas por categoria");
      console.error(e);
    }
  }, [branchId]);

  useEffect(() => {
    loadCategoryPolicies();
  }, [loadCategoryPolicies]);

  const handleBootstrapPolicies = async () => {
    if (!branchId) return;
    const res = await apiFetch("/api/pricing/category-policies/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId }),
    });
    if (!res.ok) {
      showToast("error", "No se pudieron crear politicas default");
      return;
    }
    const data = unwrapApiData(await res.json()) as { created: number; skipped: number };
    showToast("success", `Politicas default: ${data.created} creadas, ${data.skipped} existentes`);
    loadCategoryPolicies();
  };

  const handleSavePolicy = async (categoryId: string) => {
    const draft = policyDrafts[categoryId];
    if (!draft) return;
    const res = await apiFetch("/api/pricing/category-policies", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      showToast("error", body?.error?.message ?? "No se pudo guardar la politica");
      return;
    }
    showToast("success", "Politica guardada");
    loadCategoryPolicies();
    onSaved?.();
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[var(--color-text)]">Politicas por categoria</h3>
            <p className="text-xs text-[var(--color-text-muted)]">Margenes, utilidad minima, descuento y redondeo por familia.</p>
          </div>
          <Button onClick={handleBootstrapPolicies} variant="secondary">Crear defaults</Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[76rem] text-xs">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Categoria</th>
                <th>Min %</th>
                <th>Objetivo %</th>
                <th>Utilidad C$</th>
                <th>Desc. max %</th>
                <th>Unid/mes</th>
                <th>Valor/mes</th>
                <th>Gasto asignado</th>
                <th>Stock</th>
                <th>Modo</th>
                <th>Redondeo</th>
                <th>Notas</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {categoryPolicies.map((policy) => {
                const draft = policyDrafts[policy.categoryId] ?? policy;
                const updateDraft = (patch: Partial<CategoryPolicyRow>) => {
                  setPolicyDrafts((prev) => ({ ...prev, [policy.categoryId]: { ...draft, ...patch } }));
                };
                const numberInput = (key: keyof CategoryPolicyRow) => (
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-24 rounded border border-slate-300 px-2 py-1"
                    value={draft[key] === null ? "" : String(draft[key])}
                    onChange={(e) => updateDraft({ [key]: e.target.value === "" ? null : Number(e.target.value) } as Partial<CategoryPolicyRow>)}
                  />
                );
                return (
                  <tr key={policy.categoryId} className="border-b align-top">
                    <td className="py-2">
                      <div className="font-semibold">{policy.categoryCode} - {policy.categoryName}</div>
                      {policy.isVirtualDefault ? <div className="text-[10px] text-amber-600">Default virtual</div> : null}
                    </td>
                    <td>{numberInput("minMarginPercent")}</td>
                    <td>{numberInput("targetMarginPercent")}</td>
                    <td>{numberInput("minProfitAmount")}</td>
                    <td>{numberInput("maxDiscountPercent")}</td>
                    <td>{numberInput("estimatedMonthlyUnits")}</td>
                    <td>{numberInput("estimatedMonthlySalesValue")}</td>
                    <td>{numberInput("monthlyExpenseAllocation")}</td>
                    <td>
                      <select className="rounded border px-2 py-1" value={draft.stockPolicy} onChange={(e) => updateDraft({ stockPolicy: e.target.value })}>
                        <option value="HIGH_STOCK">HIGH_STOCK</option>
                        <option value="NORMAL">NORMAL</option>
                        <option value="LOW_STOCK">LOW_STOCK</option>
                        <option value="ON_DEMAND">ON_DEMAND</option>
                      </select>
                    </td>
                    <td>
                      <select className="rounded border px-2 py-1" value={draft.priceMode} onChange={(e) => updateDraft({ priceMode: e.target.value })}>
                        <option value="CATEGORY">CATEGORY</option>
                        <option value="MANUAL">MANUAL</option>
                        <option value="ABC_XYZ_READY">ABC_XYZ_READY</option>
                      </select>
                    </td>
                    <td>
                      <select className="rounded border px-2 py-1" value={draft.roundingRule} onChange={(e) => updateDraft({ roundingRule: e.target.value })}>
                        <option value="NONE">NONE</option>
                        <option value="NEAREST_1">NEAREST_1</option>
                        <option value="NEAREST_5">NEAREST_5</option>
                        <option value="NEAREST_10">NEAREST_10</option>
                        <option value="NEAREST_50">NEAREST_50</option>
                        <option value="NEAREST_100">NEAREST_100</option>
                        <option value="ENDING_9">ENDING_9</option>
                        <option value="ENDING_90">ENDING_90</option>
                        <option value="ENDING_99">ENDING_99</option>
                      </select>
                    </td>
                    <td>
                      <input className="w-40 rounded border px-2 py-1" value={draft.notes ?? ""} onChange={(e) => updateDraft({ notes: e.target.value })} />
                    </td>
                    <td>
                      <Button size="sm" onClick={() => handleSavePolicy(policy.categoryId)}>Guardar</Button>
                    </td>
                  </tr>
                );
              })}
              {!categoryPolicies.length ? (
                <tr><td colSpan={13} className="py-8 text-center text-[var(--color-text-muted)]">No hay categorias activas para mostrar.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
