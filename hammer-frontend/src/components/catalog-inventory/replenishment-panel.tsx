"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Sparkles, Shuffle, Plus, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, qty } from "@/lib/format";
import { Kpi } from "@/components/catalog-inventory/catalog-inventory-admin";
import type { Branch } from "@/components/catalog-inventory/catalog-inventory-admin";

/**
 * Fase 5 (prompt-flujo-velocidad.md): extraído de catalog-inventory-admin.tsx
 * (era la pestaña "reorder") para poder cargarlo con next/dynamic — solo se
 * monta cuando el usuario abre esa pestaña. Mismo comportamiento.
 */

type ReplenishmentRecommendation = {
  productId: string;
  sku: string;
  barcode?: string | null;
  name: string;
  categoryName?: string | null;
  branchId: string;
  stockOnHand: number;
  availableStock: number;
  unitsSoldLast30Days: number;
  unitsSoldLast90Days: number;
  averageDailyDemand: number;
  abcClass: "A" | "B" | "C";
  xyzClass: "X" | "Y" | "Z";
  combinedClass: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  leadTimeDays: number;
  safetyDays: number;
  coverageDays: number;
  reorderPoint: number;
  targetStock: number;
  suggestedOrderQty: number;
  effectiveCost: number | null;
  effectivePrice: number | null;
  grossMarginPercent: number | null;
  estimatedPurchaseCost: number | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  recommendationType: "BUY" | "TRANSFER_IN" | "DO_NOT_BUY" | "ON_DEMAND" | "OVERSTOCK" | "REVIEW_PRICE";
  message: string;
  warnings: string[];
  recommendedActions: string[];
};
type ReplenishmentSummary = {
  urgentCount: number;
  highCount: number;
  buyCount: number;
  transferInCount: number;
  overstockCount: number;
  onDemandCount: number;
  reviewPriceCount: number;
  estimatedTotalPurchaseCost: number;
};
type TransferOpportunity = {
  productId: string;
  sku: string;
  barcode?: string | null;
  name: string;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  availableToTransfer: number;
  suggestedTransferQty: number;
  toBranchStockOnHand: number;
  toBranchReorderPoint: number;
  fromBranchStockOnHand: number;
  fromBranchReorderPoint: number;
  estimatedTransferCost: number | null;
  estimatedPurchaseCostAvoided: number | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  message: string;
  warnings: string[];
};

export function ReplenishmentPanel({ branches, selectedBranchId }: { branches: Branch[]; selectedBranchId?: string }) {
  const [branchId, setBranchId] = useState(selectedBranchId || branches[0]?.id || "");
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<ReplenishmentRecommendation[]>([]);
  const [summary, setSummary] = useState<ReplenishmentSummary | null>(null);
  const [transfers, setTransfers] = useState<TransferOpportunity[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [selectedTransferKeys, setSelectedTransferKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (selectedBranchId) setBranchId(selectedBranchId);
  }, [selectedBranchId]);

  async function analyze() {
    if (!branchId) {
      toast.error("Selecciona una sucursal para analizar reposicion.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/replenishment/recommendations?branchId=${branchId}&includeTransferOpportunities=true`, { cache: "no-store" });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo analizar reposicion.");
      const data = unwrapApiData(raw) as { recommendations: ReplenishmentRecommendation[]; summary: ReplenishmentSummary };
      setRecommendations(data.recommendations);
      setSummary(data.summary);
      setSelectedProductIds(new Set(data.recommendations.filter((item) => item.recommendationType === "BUY" && item.suggestedOrderQty > 0).map((item) => item.productId)));
      toast.success("Analisis de reposicion actualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al analizar reposicion.");
    } finally {
      setLoading(false);
    }
  }

  async function loadTransfers() {
    if (!branchId) {
      toast.error("Selecciona una sucursal.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/replenishment/transfers?branchId=${branchId}`, { cache: "no-store" });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudieron cargar traslados sugeridos.");
      const data = unwrapApiData(raw) as { opportunities: TransferOpportunity[] };
      setTransfers(data.opportunities);
      setSelectedTransferKeys(new Set(data.opportunities.map((item) => `${item.fromBranchId}:${item.productId}`)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al cargar traslados.");
    } finally {
      setLoading(false);
    }
  }

  async function createPurchaseDraft() {
    const items = recommendations
      .filter((item) => selectedProductIds.has(item.productId) && item.recommendationType === "BUY" && item.suggestedOrderQty > 0)
      .map((item) => ({ productId: item.productId, quantity: item.suggestedOrderQty }));
    if (!branchId || items.length === 0) {
      toast.error("Selecciona al menos un producto con recomendacion de compra.");
      return;
    }
    const res = await apiFetch("/api/inventory/replenishment/create-purchase-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId, items, notes: "Borrador creado desde Reposicion inteligente" }),
    });
    const raw = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(raw?.error?.message ?? "No se pudo crear el borrador de compra.");
      return;
    }
    const data = unwrapApiData(raw);
    toast.success(`Borrador de compra ${data.purchaseOrderId} creado (${data.status}).`);
  }

  async function createTransferDraft() {
    const selected = transfers.filter((item) => selectedTransferKeys.has(`${item.fromBranchId}:${item.productId}`));
    if (selected.length === 0) {
      toast.error("Selecciona al menos un traslado sugerido.");
      return;
    }
    const first = selected[0];
    const sameRoute = selected.every((item) => item.fromBranchId === first.fromBranchId && item.toBranchId === first.toBranchId);
    if (!sameRoute) {
      toast.error("Selecciona traslados de la misma sucursal origen y destino para crear un borrador.");
      return;
    }
    const res = await apiFetch("/api/inventory/replenishment/create-transfer-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromBranchId: first.fromBranchId,
        toBranchId: first.toBranchId,
        items: selected.map((item) => ({ productId: item.productId, quantity: item.suggestedTransferQty })),
        notes: "Borrador creado desde Reposicion inteligente",
      }),
    });
    const raw = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(raw?.error?.message ?? "No se pudo crear el borrador de traslado.");
      return;
    }
    const data = unwrapApiData(raw);
    toast.success(`Borrador de traslado ${data.transferId} creado (${data.status}).`);
  }

  function toggleProduct(productId: string) {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  function toggleTransfer(key: string) {
    setSelectedTransferKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <Card noPadding>
        <div className="hm-card-header-amber">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Settings2 className="h-4 w-4" /> Reposicion inteligente</h2>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <select className="hm-input h-10 min-w-[220px]" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">Seleccionar sucursal</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>)}
            </select>
            <Button variant="primary" onClick={analyze} loading={loading} icon={<Sparkles className="h-4 w-4" />}>Analizar reposicion</Button>
            <Button variant="secondary" onClick={loadTransfers} loading={loading} icon={<Shuffle className="h-4 w-4" />}>Ver traslados sugeridos</Button>
            <Button variant="success" onClick={createPurchaseDraft} disabled={selectedProductIds.size === 0} icon={<Plus className="h-4 w-4" />}>Crear borrador de compra</Button>
            <Button variant="secondary" onClick={createTransferDraft} disabled={selectedTransferKeys.size === 0} icon={<Shuffle className="h-4 w-4" />}>Crear borrador de traslado</Button>
          </div>

          {summary ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Urgentes" value={summary.urgentCount} />
              <Kpi label="Compras sugeridas" value={summary.buyCount} />
              <Kpi label="Traslados sugeridos" value={summary.transferInCount} />
              <Kpi label="Sobrestock" value={summary.overstockCount} />
              <Kpi label="Bajo pedido" value={summary.onDemandCount} />
              <Kpi label="Revisar precio" value={summary.reviewPriceCount} />
              <Kpi label="Alta prioridad" value={summary.highCount} />
              <Kpi label="Costo compra est." value={money(summary.estimatedTotalPurchaseCost)} />
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="hm-table min-w-[1250px] w-full">
              <thead>
                <tr>
                  <th></th><th>SKU</th><th>Producto</th><th>Stock disp.</th><th>Ventas 30/90</th><th>ABC-XYZ</th><th>Punto rep.</th><th>Objetivo</th><th>Sugerido</th><th>Tipo</th><th>Prioridad</th><th>Mensaje</th>
                </tr>
              </thead>
              <tbody>
                {recommendations.map((item) => (
                  <tr key={item.productId}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedProductIds.has(item.productId)}
                        disabled={item.recommendationType !== "BUY" || item.suggestedOrderQty <= 0}
                        onChange={() => toggleProduct(item.productId)}
                      />
                    </td>
                    <td className="font-mono font-semibold">{item.sku}</td>
                    <td><div className="font-medium">{item.name}</div><div className="text-xs text-[var(--color-text-muted)]">{item.categoryName ?? "Sin categoria"}</div></td>
                    <td>{qty(item.availableStock)}</td>
                    <td>{qty(item.unitsSoldLast30Days)} / {qty(item.unitsSoldLast90Days)}</td>
                    <td><Badge variant={item.riskLevel === "CRITICAL" || item.riskLevel === "HIGH" ? "warning" : "info"}>{item.combinedClass}</Badge></td>
                    <td>{qty(item.reorderPoint)}</td>
                    <td>{qty(item.targetStock)}</td>
                    <td className="font-semibold">{qty(item.suggestedOrderQty)}</td>
                    <td>{item.recommendationType}</td>
                    <td><Badge variant={item.priority === "URGENT" ? "danger" : item.priority === "HIGH" ? "warning" : "success"}>{item.priority}</Badge></td>
                    <td className="max-w-[320px]">
                      <div>{item.message}</div>
                      {item.warnings.length > 0 ? <div className="mt-1 text-xs text-amber-700">{item.warnings[0]}</div> : null}
                    </td>
                  </tr>
                ))}
                {recommendations.length === 0 ? <tr><td colSpan={12} className="py-6 text-center text-[var(--color-text-muted)]">Ejecuta el analisis para ver recomendaciones.</td></tr> : null}
              </tbody>
            </table>
          </div>

          {transfers.length > 0 ? (
            <div className="rounded-xl border border-[var(--color-border)] p-3">
              <h3 className="mb-2 text-sm font-semibold">Traslados sugeridos</h3>
              <div className="overflow-x-auto">
                <table className="hm-table min-w-[900px] w-full">
                  <thead><tr><th></th><th>Producto</th><th>Origen</th><th>Destino</th><th>Disponible</th><th>Trasladar</th><th>Ahorro compra</th><th>Prioridad</th></tr></thead>
                  <tbody>
                    {transfers.map((item) => {
                      const key = `${item.fromBranchId}:${item.productId}`;
                      return (
                        <tr key={key}>
                          <td><input type="checkbox" checked={selectedTransferKeys.has(key)} onChange={() => toggleTransfer(key)} /></td>
                          <td><span className="font-semibold">{item.sku}</span> - {item.name}</td>
                          <td>{item.fromBranchName}</td>
                          <td>{item.toBranchName}</td>
                          <td>{qty(item.availableToTransfer)}</td>
                          <td className="font-semibold">{qty(item.suggestedTransferQty)}</td>
                          <td>{item.estimatedPurchaseCostAvoided === null ? "N/A" : money(item.estimatedPurchaseCostAvoided)}</td>
                          <td><Badge variant={item.priority === "URGENT" ? "danger" : item.priority === "HIGH" ? "warning" : "success"}>{item.priority}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
