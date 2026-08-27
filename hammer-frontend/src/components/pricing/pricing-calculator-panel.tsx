"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Calculator,
  Settings,
  Percent,
  Package,
  PieChart,
  Info,
  Save,
  DollarSign,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  Receipt,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import {
  type Branch,
  type ApplyPreviewRow,
  type ExpenseSummary,
  type ProductOption,
  type PricingProductContext,
  type CommercialAlert,
  type CategoryPolicyRow,
  type SuggestedPriceResult,
} from "@/components/expenses/expense-manager.types";

/**
 * Fase 1 (prompt-mudanza-zona-precios.md) — extraído de expense-manager.tsx
 * (antes activeTab === "pricing"). Es una mudanza, no una reescritura: el
 * comportamiento es idéntico, solo cambió dónde vive el código y de dónde
 * saca sus datos. `branchId` llega por props — este panel ya NO comparte
 * `selectedBranchId` ni ningún otro estado con Gastos (ExpenseManager); cada
 * dato que antes tomaba prestado del estado compartido (gasto operativo
 * mensual, configuración de precios) ahora lo carga con su propio fetch.
 *
 * El formulario de configuración (margen/unidades/prorrateo) vive TAMBIÉN acá
 * — con su propia copia de estado — porque hoy comparte pantalla con la
 * calculadora y se usa para armar el payload de cálculo. pricing-config-panel.tsx
 * es la misma lógica en un archivo propio, para el tab "Configuración" de la
 * zona Precios (Fase 2) — sí hay overlap de ~90 líneas entre ambos archivos;
 * es deliberado: cada panel maneja su propio estado interno para no volver a
 * acoplar Precios con Gastos, que es justamente el riesgo que esta mudanza
 * quiere evitar.
 */

const PRICE_SOURCE_LABEL: Record<PricingProductContext["priceSource"], string> = {
  BRANCH: "Sucursal",
  STANDARD: "Precio estándar",
  FUSION_DERIVED: "Derivado de fusión",
  MISSING: "Sin precio",
};

export function PricingCalculatorPanel({
  branchId,
  onSaved,
  initialProductId,
}: {
  branchId: string;
  /** Se dispara tras guardar configuración o aplicar un precio — para que quien lo embeba (p.ej. la Bandeja) pueda refrescar. */
  onSaved?: () => void;
  /** Fase 4 (prompt-mudanza-zona-precios.md) — precarga desde la ficha de producto (?tab=calculator&productId=...&branchId=...). */
  initialProductId?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);

  /* Config form (copia propia — ver comentario de archivo) */
  const [configForm, setConfigForm] = useState({
    desiredMarginPercent: "30",
    estimatedMonthlyUnits: "1000",
    prorationMethod: "BY_QUANTITY",
  });

  /* Calculator state */
  const [calcCost, setCalcCost] = useState("");
  const [calcResult, setCalcResult] = useState<SuggestedPriceResult | null>(null);
  const [ivaPercent, setIvaPercent] = useState("15");
  const [calcMode, setCalcMode] = useState<"SIMPLE" | "ADVANCED">(initialProductId ? "ADVANCED" : "SIMPLE");
  const [includeTaxInCost, setIncludeTaxInCost] = useState(true);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [selectedProductId, setSelectedProductId] = useState(initialProductId ?? "");
  const [productContext, setProductContext] = useState<PricingProductContext | null>(null);
  const [calcCostTouched, setCalcCostTouched] = useState(false);
  const [useCategoryPolicy, setUseCategoryPolicy] = useState(false);
  const [useCommercialIntelligence, setUseCommercialIntelligence] = useState(false);
  const [commercialAlerts, setCommercialAlerts] = useState<CommercialAlert[]>([]);

  /* Fase 2 (prompt-motor-precios-lote-herencia-gobierno.md) — alcance de "aplicar precio" */
  const [applyScope, setApplyScope] = useState<"BRANCH" | "SELECTED_BRANCHES" | "ALL_BRANCHES">("BRANCH");
  const [selectedApplyBranchIds, setSelectedApplyBranchIds] = useState<string[]>([]);
  const [applyPreview, setApplyPreview] = useState<ApplyPreviewRow[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [advancedCalc, setAdvancedCalc] = useState({
    purchaseFreightPerUnit: "",
    otherCostPerUnit: "",
    shrinkagePercent: "",
    minProfitAmount: "",
    marketMinPrice: "",
    marketMaxPrice: "",
    roundingRule: "NONE",
    estimatedMonthlySalesValue: "",
    productMonthlySalesValue: "",
    estimatedMonthlyUnitsForThisProduct: "",
    expenseAllocationScope: "BRANCH" as "BRANCH" | "CATEGORY" | "PRODUCT" | "MANUAL",
    manualOperatingExpensePerUnit: "",
    branchMonthlyUnits: "",
    categoryMonthlyUnits: "",
    productMonthlyUnits: "",
  });

  const formatC = (n: number) =>
    `C$${n.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const selectedBranch = branches.find((b) => b.id === branchId);

  /* ── Load branches (nombres para "elegir sucursales" y la previsualización) ── */
  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((raw) => {
        const data = unwrapApiData(raw);
        setBranches(Array.isArray(data) ? data : []);
      })
      .catch(console.error);
  }, []);

  /* ── Load config + gasto operativo de la sucursal (para el formulario y el cálculo) ── */
  const loadBranchData = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const [sumRes, cfgRes] = await Promise.all([
        fetch(`/api/expenses?branchId=${branchId}&summary=true`),
        fetch(`/api/pricing/config?branchId=${branchId}`),
      ]);
      const sumData = unwrapApiData(await sumRes.json());
      const cfgData = unwrapApiData(await cfgRes.json());
      setSummary(sumData as ExpenseSummary);
      setProductContext(null);
      setCommercialAlerts([]);
      if (cfgData && (cfgData as { id?: string }).id) {
        const cfg = cfgData as { desiredMarginPercent: number; estimatedMonthlyUnits: number; prorationMethod: string };
        setConfigForm({
          desiredMarginPercent: String(cfg.desiredMarginPercent),
          estimatedMonthlyUnits: String(cfg.estimatedMonthlyUnits),
          prorationMethod: cfg.prorationMethod || "BY_QUANTITY",
        });
      }
    } catch (e) {
      console.error("Error loading pricing data:", e);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    loadBranchData();
  }, [loadBranchData]);

  useEffect(() => {
    if (!branchId) return;
    fetch(`/api/catalog/products?isActive=true&branchId=${branchId}`)
      .then((res) => res.json())
      .then((raw) => {
        const data = unwrapApiData(raw);
        setProductOptions(Array.isArray(data) ? data.map((item: ProductOption) => ({ id: item.id, sku: item.sku, name: item.name })) : []);
      })
      .catch(() => setProductOptions([]));
  }, [branchId]);

  /* ── Handlers ── */

  const handleSaveConfig = async () => {
    if (!branchId) return;
    try {
      const res = await apiFetch("/api/pricing/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          desiredMarginPercent: parseFloat(configForm.desiredMarginPercent),
          estimatedMonthlyUnits: parseFloat(configForm.estimatedMonthlyUnits),
          prorationMethod: configForm.prorationMethod,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      showToast("success", "Configuración guardada");
      loadBranchData();
      onSaved?.();
    } catch (e) {
      showToast("error", "Error al guardar configuración");
      console.error(e);
    }
  };

  const handleCalculate = async () => {
    if (!branchId || !calcCost) return;
    try {
      const payload = {
        branchId,
        productId: selectedProductId || undefined,
        mode: calcMode,
        baseCost: calcCost,
        taxPercent: ivaPercent,
        includeTaxInCost,
        monthlyOperatingExpenses: useCategoryPolicy && productContext ? productContext.categoryPolicy.monthlyExpenseAllocation : (summary?.grandTotal ?? 0),
        estimatedMonthlyUnits: configForm.estimatedMonthlyUnits,
        expenseAllocationScope: advancedCalc.expenseAllocationScope,
        manualOperatingExpensePerUnit: advancedCalc.manualOperatingExpensePerUnit,
        branchMonthlyUnits: advancedCalc.branchMonthlyUnits,
        categoryMonthlyUnits: advancedCalc.categoryMonthlyUnits,
        productMonthlyUnits: advancedCalc.productMonthlyUnits,
        prorateMethod: configForm.prorationMethod,
        marginPercent: configForm.desiredMarginPercent,
        useCategoryPolicy,
        useCommercialIntelligence,
        ...(calcMode === "ADVANCED" ? advancedCalc : {}),
      };

      const res = await apiFetch("/api/pricing/suggested", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed");
      const data = unwrapApiData(await res.json());
      setCalcResult(data as SuggestedPriceResult);
    } catch (e) {
      showToast("error", "Error al calcular precio");
      console.error(e);
    }
  };

  const handleLoadProductContext = useCallback(async (productIdOverride?: string) => {
    const productId = productIdOverride ?? selectedProductId;
    if (!branchId || !productId) return;
    try {
      const res = await fetch(`/api/pricing/product-context?branchId=${branchId}&productId=${productId}`);
      if (!res.ok) throw new Error("Failed");
      const data = unwrapApiData(await res.json()) as PricingProductContext;
      setProductContext(data);
      setUseCategoryPolicy(false);
      setUseCommercialIntelligence(false);
      if (data.effectiveCost !== null && (!calcCost || !calcCostTouched || confirm("El costo base ya tiene un valor. ¿Quieres reemplazarlo con el costo efectivo del producto?"))) {
        setCalcCost(String(data.effectiveCost));
        setCalcCostTouched(false);
      }
      showToast("success", "Datos del producto cargados");
    } catch (e) {
      showToast("error", "No se pudieron cargar los datos del producto");
      console.error(e);
    }
  }, [branchId, selectedProductId, calcCost, calcCostTouched]);

  /* Fase 4 — precarga desde la ficha de producto: solo al montar. */
  useEffect(() => {
    if (initialProductId) {
      setSelectedProductId(initialProductId);
      void handleLoadProductContext(initialProductId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyPolicyToCalculator = (policy: CategoryPolicyRow) => {
    setConfigForm((prev) => ({
      ...prev,
      desiredMarginPercent: String(policy.targetMarginPercent),
      estimatedMonthlyUnits: String(policy.estimatedMonthlyUnits),
    }));
    setAdvancedCalc((prev) => ({
      ...prev,
      minProfitAmount: String(policy.minProfitAmount),
      estimatedMonthlySalesValue: policy.estimatedMonthlySalesValue === null ? prev.estimatedMonthlySalesValue : String(policy.estimatedMonthlySalesValue),
      expenseAllocationScope: "CATEGORY",
      categoryMonthlyUnits: String(policy.estimatedMonthlyUnits),
      roundingRule: policy.roundingRule,
    }));
  };

  const handleUseCategoryPolicyToggle = (checked: boolean) => {
    setUseCategoryPolicy(checked);
    if (checked && productContext?.categoryPolicy) {
      applyPolicyToCalculator(productContext.categoryPolicy);
      setConfigForm((prev) => ({ ...prev, estimatedMonthlyUnits: String(productContext.categoryPolicy.estimatedMonthlyUnits) }));
      showToast("success", "Politica de categoria precargada: usando gasto asignado a categoria");
    }
  };

  const handleUseCommercialIntelligenceToggle = (checked: boolean) => {
    setUseCommercialIntelligence(checked);
    const intelligence = productContext?.commercialIntelligence;
    if (checked && intelligence) {
      setConfigForm((prev) => ({ ...prev, desiredMarginPercent: String(intelligence.recommendedMarginPercent) }));
      setAdvancedCalc((prev) => ({
        ...prev,
        minProfitAmount: String(intelligence.recommendedMinProfitAmount),
      }));
      showToast("success", "Inteligencia ABC-XYZ precargada");
    }
  };

  const loadCommercialAlerts = async () => {
    if (!branchId) return;
    try {
      const res = await fetch(`/api/pricing/commercial-alerts?branchId=${branchId}`);
      if (!res.ok) throw new Error("Failed");
      const data = unwrapApiData(await res.json()) as { alerts?: CommercialAlert[] };
      setCommercialAlerts(data.alerts ?? []);
    } catch (e) {
      showToast("error", "No se pudieron cargar las alertas comerciales");
      console.error(e);
    }
  };

  /** Cuerpo compartido por preview (dryRun) y aplicación real — mismo alcance, mismo precio, difiere solo dryRun (§2.2/§2.3). */
  function buildApplyPricePayload(dryRun: boolean) {
    if (!calcResult || !productContext) return null;
    return {
      productId: productContext.productId,
      applyScope,
      branchId: applyScope === "BRANCH" ? branchId : undefined,
      branchIds: applyScope === "SELECTED_BRANCHES" ? selectedApplyBranchIds : undefined,
      suggestedPrice: calcResult.suggestedPrice,
      minPrice: calcResult.minPrice,
      maxPrice: calcResult.maxPrice,
      totalInternalCost: calcResult.totalInternalCost,
      effectiveCost: productContext.effectiveCost,
      marginPercent: calcResult.marginPercent,
      grossMarginPercent: calcResult.grossMarginPercent,
      markupPercent: calcResult.markupPercent,
      roundingRule: calcResult.roundingRule,
      reason: "Aplicado desde calculadora de precios",
      calculationSnapshot: calcResult,
      dryRun,
    };
  }

  /** §2.3 — antes de confirmar, tabla de previsualización: aplicar precios en lote es irreversible en la práctica. */
  const handlePreviewApply = async () => {
    if (!calcResult || !productContext) return;
    if (calcResult.canApplyPrice === false || calcResult.marketConflict?.hasConflict) {
      showToast("warning", "Corrige costos, ambito de prorrateo o precio maximo de mercado antes de aplicar.");
      return;
    }
    if (applyScope === "SELECTED_BRANCHES" && selectedApplyBranchIds.length === 0) {
      showToast("warning", "Elegí al menos una sucursal.");
      return;
    }

    const payload = buildApplyPricePayload(true);
    if (!payload) return;
    setPreviewLoading(true);
    setApplyPreview(null);
    try {
      const res = await apiFetch("/api/pricing/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo previsualizar la aplicación");
      const data = unwrapApiData(raw) as { results: Omit<ApplyPreviewRow, "branchName">[] };
      setApplyPreview(data.results.map((r) => ({ ...r, branchName: branches.find((b) => b.id === r.branchId)?.name ?? r.branchId })));
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "No se pudo previsualizar la aplicación");
      console.error(e);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirmApply = async () => {
    const payload = buildApplyPricePayload(false);
    if (!payload) return;
    setApplying(true);
    try {
      const res = await apiFetch("/api/pricing/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo aplicar el precio");
      const data = unwrapApiData(raw) as { results: Array<{ branchId: string; applied: boolean }> };
      const appliedCount = data.results.filter((r) => r.applied).length;
      const failedCount = data.results.length - appliedCount;
      if (failedCount === 0) {
        showToast("success", data.results.length === 1 ? `Precio aplicado en ${selectedBranch?.name ?? "la sucursal"}.` : `Precio aplicado en ${appliedCount} sucursal(es).`);
      } else {
        showToast("warning", `${appliedCount} aplicado(s), ${failedCount} con error.`);
      }
      setApplyPreview(null);
      await handleLoadProductContext();
      onSaved?.();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "No se pudo aplicar el precio");
      console.error(e);
    } finally {
      setApplying(false);
    }
  };

  /* ══════════════════════════════════════════════════════════════ */

  if (loading) {
    return <div className="text-center py-8 text-[var(--color-text-muted)]">Cargando datos...</div>;
  }

  return (
    <div className="space-y-8">

      {/* ── Header de sección ── */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md shadow-indigo-500/25">
          <DollarSign className="h-5 w-5 text-white" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-[var(--color-text)] tracking-tight">
            Gestión de Precios
          </h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            {selectedBranch?.name} — Configuración, cálculo de precios y márgenes
          </p>
        </div>
      </div>

      {/* ── Layout 2 columnas: Config + Calculadora ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── COLUMNA IZQUIERDA: Configuración de precios ── */}
        <div className="relative overflow-hidden rounded-2xl border border-[var(--color-info-200)] bg-[var(--color-surface)] shadow-md">
          {/* Header azul vibrante */}
          <div className="hm-card-header-blue px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/20">
                <Settings className="h-5 w-5 text-white" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Configuración de Precios</h4>
                <p className="text-xs text-blue-100">Parámetros para el cálculo automático</p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* Margen */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                <Percent className="h-3.5 w-3.5 text-[var(--color-info-600)]" />
                Margen de Utilidad
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0.1"
                  max="99.9"
                  step="0.1"
                  value={configForm.desiredMarginPercent}
                  onChange={(e) => setConfigForm((p) => ({ ...p, desiredMarginPercent: e.target.value }))}
                  className="w-full rounded-xl border-2 border-slate-300 bg-white px-4 py-3 text-2xl font-bold text-[var(--color-text)] transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 focus:outline-none"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-500">%</span>
              </div>
              <p className="text-xs text-slate-600 flex items-center gap-1">
                <Info className="h-3 w-3 text-blue-500" />
                Porcentaje de ganancia sobre el precio de venta final
              </p>
            </div>

            {/* Unidades */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                <Package className="h-3.5 w-3.5 text-[var(--color-info-600)]" />
                Unidades vendidas estimadas al mes en esta sucursal
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={configForm.estimatedMonthlyUnits}
                  onChange={(e) => setConfigForm((p) => ({ ...p, estimatedMonthlyUnits: e.target.value }))}
                  className="w-full rounded-xl border-2 border-slate-300 bg-white px-4 py-3 text-2xl font-bold text-[var(--color-text)] transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 focus:outline-none"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">/ mes</span>
              </div>
              <p className="text-xs text-slate-600 flex items-center gap-1">
                <Info className="h-3 w-3 text-blue-500" />
                Cantidad total aproximada de unidades fisicas vendidas al mes. No significa SKUs distintos.
              </p>
            </div>

            {/* Método de prorrateo */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                <PieChart className="h-3.5 w-3.5 text-[var(--color-info-600)]" />
                Método de Prorrateo
              </label>
              <select
                className="w-full rounded-xl border-2 border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-[var(--color-text)] transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 focus:outline-none"
                value={configForm.prorationMethod}
                onChange={(e) => setConfigForm((p) => ({ ...p, prorationMethod: e.target.value }))}
              >
                <option value="BY_QUANTITY">Por cantidad (unidades)</option>
                <option value="BY_VALUE">Por valor (C$)</option>
              </select>
              <p className="text-xs text-slate-600">
                {configForm.prorationMethod === "BY_VALUE"
                  ? "Gastos se reparten segun participacion economica del producto o lote."
                  : "Gastos se dividen equitativamente entre unidades vendidas."}
              </p>
            </div>

            {/* Resumen rápido de gastos */}
            {summary && (
              <div className="rounded-xl bg-amber-50 border-2 border-amber-300 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Receipt className="h-4 w-4 text-amber-700" />
                  <span className="text-sm font-bold text-amber-800">Gastos Operativos Mensuales</span>
                </div>
                <p className="text-2xl font-extrabold text-amber-700">{formatC(summary.grandTotal)}</p>
                <p className="text-xs font-medium text-amber-700 mt-1">
                  Prorrateado: {formatC(summary.grandTotal / Math.max(Number(configForm.estimatedMonthlyUnits) || 1, 1))} por unidad
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={handleSaveConfig}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-3.5 px-6 shadow-lg shadow-blue-600/30 hover:shadow-blue-600/40 transition-all duration-200"
            >
              <Save className="h-4 w-4" />
              Guardar Configuración
            </button>
          </div>
        </div>

        {/* ── COLUMNA DERECHA: Calculadora ── */}
        <div className="relative overflow-hidden rounded-2xl border border-[var(--color-success-200)] bg-[var(--color-surface)] shadow-md">
          {/* Header verde vibrante */}
          <div className="hm-card-header-green px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/20">
                <Calculator className="h-5 w-5 text-white" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Calculadora de Precio</h4>
                <p className="text-xs text-emerald-100">Ingresa el costo y obtén el precio sugerido</p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-5">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
              {(["SIMPLE", "ADVANCED"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setCalcMode(mode)}
                  className={`rounded-lg px-3 py-2 text-sm font-bold transition ${
                    calcMode === mode ? "bg-white text-emerald-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {mode === "SIMPLE" ? "Simple" : "Avanzado"}
                </button>
              ))}
            </div>

            {/* Costo base */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                <DollarSign className="h-3.5 w-3.5 text-emerald-600" />
                Costo Base sin IVA
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-500">C$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={calcCost}
                  onChange={(e) => {
                    setCalcCost(e.target.value);
                    setCalcCostTouched(true);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleCalculate()}
                  className="w-full rounded-xl border-2 border-slate-300 bg-white pl-12 pr-4 py-3 text-2xl font-bold text-[var(--color-text)] transition-all focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15 focus:outline-none"
                />
              </div>
            </div>

            {/* IVA */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                IVA sobre el costo de compra
              </label>
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    placeholder="15"
                    value={ivaPercent}
                    onChange={(e) => setIvaPercent(e.target.value)}
                    className="w-full rounded-xl border-2 border-slate-300 bg-white px-4 py-3 text-xl font-bold text-[var(--color-text)] transition-all focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15 focus:outline-none"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-500">%</span>
                </div>
                {/* Quick-set buttons */}
                <div className="flex gap-1.5">
                  {[0, 15].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setIvaPercent(String(v))}
                      className={`rounded-lg px-4 py-2.5 text-sm font-bold transition-all ${
                        Number(ivaPercent) === v
                          ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30 border-2 border-emerald-600"
                          : "bg-slate-100 text-slate-700 border-2 border-slate-300 hover:bg-slate-200"
                      }`}
                    >
                      {v === 0 ? "Sin IVA" : `${v}%`}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={includeTaxInCost}
                  onChange={(e) => setIncludeTaxInCost(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Incluir IVA en el costo interno
              </label>
            </div>

            {calcMode === "ADVANCED" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                <label className="space-y-1 text-xs font-semibold text-slate-700 sm:col-span-2">
                  Producto
                  <select
                    value={selectedProductId}
                    onChange={(e) => {
                      setSelectedProductId(e.target.value);
                      setProductContext(null);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Seleccionar producto...</option>
                    {productOptions.map((product) => (
                      <option key={product.id} value={product.id}>{product.sku} - {product.name}</option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="secondary"
                  className="sm:col-span-2"
                  onClick={() => void handleLoadProductContext()}
                  disabled={!selectedProductId}
                >
                  Cargar datos del producto
                </Button>
                {productContext ? (
                  <div className="sm:col-span-2 grid gap-2 rounded-lg border border-emerald-200 bg-white p-3 text-xs">
                    <div className="flex justify-between"><span>Producto</span><strong>{productContext.sku} - {productContext.name}</strong></div>
                    <div className="flex justify-between"><span>Categoria</span><strong>{productContext.categoryName}</strong></div>
                    <div className="flex justify-between"><span>Precio semilla (referencia)</span><strong>{formatC(productContext.standardSalePrice)}</strong></div>
                    <div className="flex justify-between"><span>Precio sucursal</span><strong>{productContext.branchPrice === null ? "Sin precio" : formatC(productContext.branchPrice)}</strong></div>
                    <div className="flex justify-between"><span>Precio efectivo</span><strong>{productContext.effectivePrice === null ? "Sin precio en esta sucursal" : `${formatC(productContext.effectivePrice)} (${PRICE_SOURCE_LABEL[productContext.priceSource]})`}</strong></div>
                    <div className="flex justify-between"><span>Costo efectivo</span><strong>{productContext.effectiveCost === null ? "Sin costo" : `${formatC(productContext.effectiveCost)} (${productContext.costSource})`}</strong></div>
                    <div className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">
                      Politica: margen {productContext.categoryPolicy.targetMarginPercent}% · utilidad {formatC(productContext.categoryPolicy.minProfitAmount)} · gasto {formatC(productContext.categoryPolicy.monthlyExpenseAllocation)} · redondeo {productContext.categoryPolicy.roundingRule}
                      {productContext.categoryPolicy.isVirtualDefault ? " · default virtual" : ""}
                    </div>
                    <label className="flex items-center gap-2 text-xs font-semibold">
                      <input type="checkbox" checked={useCategoryPolicy} onChange={(e) => handleUseCategoryPolicyToggle(e.target.checked)} />
                      Usar politica de categoria
                    </label>
                    {useCategoryPolicy ? <div className="text-[11px] text-slate-600">Los valores pueden editarse manualmente antes de calcular.</div> : null}
                    {productContext.commercialIntelligence ? (
                      <div className="rounded border border-sky-200 bg-sky-50 p-2 text-sky-900">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <strong>ABC-XYZ {productContext.commercialIntelligence.combinedClass}</strong>
                          <span>Riesgo {productContext.commercialIntelligence.riskLevel}</span>
                        </div>
                        <div className="mt-1 grid gap-1 sm:grid-cols-2">
                          <span>Margen recomendado: {productContext.commercialIntelligence.recommendedMarginPercent}%</span>
                          <span>Stock: {productContext.commercialIntelligence.recommendedStockPolicy}</span>
                          <span>Descuento max: {productContext.commercialIntelligence.recommendedMaxDiscountPercent}%</span>
                          <span>Utilidad minima: {formatC(productContext.commercialIntelligence.recommendedMinProfitAmount)}</span>
                        </div>
                        {productContext.commercialIntelligence.recommendedActions.length > 0 ? (
                          <div className="mt-1 text-[11px]">{productContext.commercialIntelligence.recommendedActions.join(" ")}</div>
                        ) : null}
                        {productContext.commercialIntelligence.warnings.length > 0 ? (
                          <div className="mt-1 space-y-1">
                            {productContext.commercialIntelligence.warnings.map((warning) => (
                              <div key={warning} className="flex items-start gap-1 text-[11px] text-amber-700">
                                <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                                <span>{warning}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <label className="mt-2 flex items-center gap-2 text-xs font-semibold">
                          <input type="checkbox" checked={useCommercialIntelligence} onChange={(e) => handleUseCommercialIntelligenceToggle(e.target.checked)} />
                          Usar inteligencia ABC-XYZ
                        </label>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {[
                  ["purchaseFreightPerUnit", "Flete de compra por unidad", "C$"],
                  ["otherCostPerUnit", "Otros cargos por unidad", "C$"],
                  ["shrinkagePercent", "Merma", "%"],
                  ["minProfitAmount", "Utilidad minima", "C$"],
                  ["marketMinPrice", "Precio minimo mercado", "C$"],
                  ["marketMaxPrice", "Precio maximo mercado", "C$"],
                ].map(([key, label, suffix]) => (
                  <label key={key} className="space-y-1 text-xs font-semibold text-slate-700">
                    {label}
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={advancedCalc[key as keyof typeof advancedCalc]}
                        onChange={(e) => setAdvancedCalc((p) => ({ ...p, [key]: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-10 text-sm"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-500">{suffix}</span>
                    </div>
                  </label>
                ))}
                <label className="space-y-1 text-xs font-semibold text-slate-700 sm:col-span-2">
                  Redondeo comercial
                  <select
                    value={advancedCalc.roundingRule}
                    onChange={(e) => setAdvancedCalc((p) => ({ ...p, roundingRule: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="NONE">Sin redondeo</option>
                    <option value="NEAREST_1">Entero mas cercano</option>
                    <option value="NEAREST_5">Multiplo de 5</option>
                    <option value="NEAREST_10">Multiplo de 10</option>
                    <option value="NEAREST_50">Multiplo de 50</option>
                    <option value="NEAREST_100">Multiplo de 100</option>
                    <option value="ENDING_9">Terminado en 9</option>
                    <option value="ENDING_90">Terminado en 90</option>
                    <option value="ENDING_99">Terminado en 99</option>
                  </select>
                </label>
                <div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <label className="space-y-1 text-xs font-semibold text-amber-900">
                    Ambito del prorrateo
                    <select
                      value={advancedCalc.expenseAllocationScope}
                      onChange={(e) => setAdvancedCalc((p) => ({ ...p, expenseAllocationScope: e.target.value as typeof p.expenseAllocationScope }))}
                      className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900"
                    >
                      <option value="BRANCH">Sucursal completa</option>
                      <option value="CATEGORY">Categoria/familia</option>
                      <option value="PRODUCT">Producto especifico</option>
                      <option value="MANUAL">Manual por unidad</option>
                    </select>
                  </label>
                  {advancedCalc.expenseAllocationScope === "MANUAL" ? (
                    <label className="mt-3 block space-y-1 text-xs font-semibold text-amber-900">
                      Gasto operativo manual por unidad
                      <Input type="number" min="0" step="0.01" value={advancedCalc.manualOperatingExpensePerUnit} onChange={(e) => setAdvancedCalc((p) => ({ ...p, manualOperatingExpensePerUnit: e.target.value }))} />
                    </label>
                  ) : (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-xs font-semibold text-amber-900">
                        {advancedCalc.expenseAllocationScope === "CATEGORY" ? "Unidades vendidas al mes en esta categoria" : advancedCalc.expenseAllocationScope === "PRODUCT" ? "Unidades vendidas al mes de este producto" : "Unidades totales vendidas al mes en la sucursal"}
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={advancedCalc.expenseAllocationScope === "CATEGORY" ? advancedCalc.categoryMonthlyUnits : advancedCalc.expenseAllocationScope === "PRODUCT" ? advancedCalc.productMonthlyUnits : advancedCalc.branchMonthlyUnits}
                          onChange={(e) => {
                            const key = advancedCalc.expenseAllocationScope === "CATEGORY" ? "categoryMonthlyUnits" : advancedCalc.expenseAllocationScope === "PRODUCT" ? "productMonthlyUnits" : "branchMonthlyUnits";
                            setAdvancedCalc((p) => ({ ...p, [key]: e.target.value }));
                          }}
                          placeholder={configForm.estimatedMonthlyUnits}
                        />
                      </label>
                      <div className="rounded border border-amber-200 bg-white p-2 text-[11px] text-amber-800">
                        {advancedCalc.expenseAllocationScope === "CATEGORY"
                          ? "Gasto mensual asignado a la categoria. No uses gasto total de sucursal aqui."
                          : advancedCalc.expenseAllocationScope === "PRODUCT"
                            ? "Gasto mensual asignado solo a este producto. Cuidado con mezclar gasto global."
                            : "Gastos operativos mensuales de la sucursal completa."}
                      </div>
                    </div>
                  )}
                  {useCategoryPolicy ? <p className="mt-2 text-[11px] font-semibold text-amber-800">Usando gasto asignado a categoria, no gasto total de sucursal.</p> : null}
                </div>
                {configForm.prorationMethod === "BY_VALUE" && (
                  <>
                    <label className="space-y-1 text-xs font-semibold text-slate-700">
                      Venta mensual estimada total
                      <Input type="number" min="0" step="0.01" value={advancedCalc.estimatedMonthlySalesValue} onChange={(e) => setAdvancedCalc((p) => ({ ...p, estimatedMonthlySalesValue: e.target.value }))} />
                    </label>
                    <label className="space-y-1 text-xs font-semibold text-slate-700">
                      Valor mensual del producto
                      <Input type="number" min="0" step="0.01" value={advancedCalc.productMonthlySalesValue} onChange={(e) => setAdvancedCalc((p) => ({ ...p, productMonthlySalesValue: e.target.value }))} />
                    </label>
                    <label className="space-y-1 text-xs font-semibold text-slate-700 sm:col-span-2">
                      Unidades mensuales del producto
                      <Input type="number" min="0" step="0.01" value={advancedCalc.estimatedMonthlyUnitsForThisProduct} onChange={(e) => setAdvancedCalc((p) => ({ ...p, estimatedMonthlyUnitsForThisProduct: e.target.value }))} />
                    </label>
                  </>
                )}
              </div>
            )}

            {/* Live preview del costo real */}
            {calcCost && (
              <div className="rounded-xl bg-emerald-50 border-2 border-emerald-200 p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Vista previa</p>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-700">Costo base</span>
                  <span className="text-sm font-bold text-slate-900">{formatC(Number(calcCost) || 0)}</span>
                </div>
                {includeTaxInCost && Number(ivaPercent) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-amber-700 font-medium">+ IVA ({ivaPercent}%)</span>
                    <span className="text-sm font-bold text-amber-700">
                      + {formatC((Number(calcCost) || 0) * (Number(ivaPercent) / 100))}
                    </span>
                  </div>
                )}
                <div className="border-t-2 border-emerald-300 pt-2 flex items-center justify-between">
                  <span className="text-sm font-bold text-emerald-800">Costo real</span>
                  <span className="text-lg font-extrabold text-emerald-800">
                    {formatC((Number(calcCost) || 0) * (includeTaxInCost ? (1 + (Number(ivaPercent) || 0) / 100) : 1))}
                  </span>
                </div>
                {!includeTaxInCost && Number(ivaPercent) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">IVA de referencia</span>
                    <span className="text-sm font-bold text-slate-700">No se suma al costo interno</span>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handleCalculate}
              disabled={!calcCost}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-green-700 hover:from-emerald-700 hover:to-green-800 disabled:from-slate-300 disabled:to-slate-400 disabled:cursor-not-allowed text-white font-bold py-3.5 px-6 shadow-lg shadow-emerald-600/30 hover:shadow-emerald-600/40 transition-all duration-200 text-base"
            >
              <Sparkles className="h-5 w-5" />
              Calcular Precio Sugerido
            </button>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ── RESULTADO DEL CÁLCULO — Card prominente full width ── */}
      {/* ══════════════════════════════════════════════════════════ */}
      {calcResult && (() => {
        const iva = calcResult.taxPercent;
        const costoBase = calcResult.baseCost;
        const ivaAmount = calcResult.taxAmount;
        const ganancia = calcResult.grossProfit;
        const gananciaPercent = calcResult.markupPercent.toFixed(1);
        const hasMarketConflict = calcResult.marketConflict?.hasConflict === true;
        const cannotApplyPrice = hasMarketConflict || calcResult.canApplyPrice === false;
        const resultTone = hasMarketConflict
          ? "border-red-300 dark:border-red-800 bg-gradient-to-br from-red-50 via-white to-amber-50 dark:from-red-950/30 dark:via-[var(--color-surface)] dark:to-amber-950/20 shadow-xl shadow-red-500/10"
          : "border-emerald-300 dark:border-emerald-800 bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-emerald-950/30 dark:via-[var(--color-surface)] dark:to-teal-950/20 shadow-xl shadow-emerald-500/10";

        return (
          <div className={`relative overflow-hidden rounded-2xl border-2 ${resultTone}`}>
            {/* Accent bar */}
            <div className={`h-1.5 ${hasMarketConflict ? "bg-gradient-to-r from-red-600 via-amber-500 to-orange-500" : "bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500"}`} />

            {!calcResult.configExists && (
              <div className="mx-6 mt-5 flex items-start gap-2 rounded-xl bg-[var(--color-warning-50)] dark:bg-amber-900/20 border border-[var(--color-warning-200)] dark:border-amber-800 p-3">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-[var(--color-warning-700)] dark:text-amber-300">
                  No hay configuración guardada para esta sucursal. Se usan valores por defecto (Margen: 30%, Unidades: 1,000).
                </p>
              </div>
            )}

            <div className="p-6 lg:p-8">
              {hasMarketConflict && (
                <div className="mb-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <div>
                      <p className="font-bold uppercase">NO RENTABLE / REVISAR COSTOS</p>
                      <p className="mt-1 text-xs">
                        El precio maximo de mercado queda por debajo del precio minimo rentable. Revisa costo, gasto operativo o ambito de prorrateo antes de aplicar.
                      </p>
                      {calcResult.marketConflict ? (
                        <p className="mt-2 text-xs font-semibold">
                          Minimo rentable: {formatC(calcResult.marketConflict.minPrice)} | Max mercado: {calcResult.marketConflict.marketMaxPrice === null ? "Sin limite" : formatC(calcResult.marketConflict.marketMaxPrice)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-6 lg:gap-8 items-start">

                {/* ── Desglose paso a paso ── */}
                <div className="space-y-1">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-4 flex items-center gap-2">
                    <Receipt className="h-3.5 w-3.5 text-emerald-600" />
                    Desglose del Cálculo
                  </h4>

                  {/* Step 1: Costo base */}
                  <div className="flex items-center gap-3 rounded-xl bg-[var(--color-surface)]/60 dark:bg-[var(--color-surface)]/5 px-4 py-3">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300">1</div>
                    <span className="flex-1 text-sm text-[var(--color-text-muted)]">Costo Base <span className="text-[10px]">(sin IVA)</span></span>
                    <span className="text-sm font-semibold tabular-nums">{formatC(costoBase)}</span>
                  </div>

                  {/* Step 2: IVA */}
                  {calcResult.warnings.length > 0 && (
                    <div className="mb-4 space-y-2">
                      {calcResult.warnings.map((warning) => (
                        <div key={warning} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                          <span>{warning}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {calcResult.includeTaxInCost && iva > 0 && (
                    <div className="flex items-center gap-3 rounded-xl bg-[var(--color-warning-50)]/80 dark:bg-amber-900/10 px-4 py-3">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-200 dark:bg-amber-800 text-[10px] font-bold text-[var(--color-warning-700)] dark:text-amber-300">2</div>
                      <span className="flex-1 text-sm text-[var(--color-warning-700)] dark:text-amber-400">+ IVA ({iva}%)</span>
                      <span className="text-sm font-semibold tabular-nums text-[var(--color-warning-700)] dark:text-amber-400">+ {formatC(ivaAmount)}</span>
                    </div>
                  )}

                  {/* Step 3: Costo Real */}
                  {calcResult.includeTaxInCost && iva > 0 && (
                    <div className="flex items-center gap-3 rounded-xl bg-slate-100/80 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 px-4 py-3">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-300 dark:bg-slate-600 text-[10px] font-bold text-slate-700 dark:text-slate-200">=</div>
                      <span className="flex-1 text-sm font-semibold text-[var(--color-text)]">Costo con IVA</span>
                      <span className="text-sm font-bold tabular-nums">{formatC(calcResult.baseCost + calcResult.taxAmount)}</span>
                    </div>
                  )}

                  {[
                    ["Flete por unidad", calcResult.purchaseFreightPerUnit],
                    ["Otros cargos", calcResult.otherCostPerUnit],
                    ["Merma", calcResult.shrinkageAmount],
                    ["Costo puesto en tienda", calcResult.landedCost],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center gap-3 rounded-xl bg-white/70 px-4 py-3">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">+</div>
                      <span className="flex-1 text-sm text-[var(--color-text-muted)]">{label}</span>
                      <span className="text-sm font-semibold tabular-nums">{formatC(Number(value))}</span>
                    </div>
                  ))}

                  {/* Step 4: Gasto operativo */}
                  <div className="flex items-center gap-3 rounded-xl bg-rose-50/60 dark:bg-rose-900/10 px-4 py-3">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-rose-200 dark:bg-rose-800 text-[10px] font-bold text-rose-700 dark:text-rose-300">{calcResult.prorateMethod === "BY_VALUE" ? "$" : "#"}</div>
                    <div className="flex-1">
                      <span className="text-sm text-rose-700 dark:text-rose-400">+ Gasto Operativo</span>
                      <span className="text-[10px] text-rose-500 dark:text-rose-500 ml-1">/ unidad</span>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-400">+ {formatC(calcResult.operatingExpensePerUnit)}</span>
                  </div>

                  {/* Divider */}
                  <div className="border-t-2 border-dashed border-slate-300 dark:border-slate-600 my-1" />

                  {/* Step 5: Costo total */}
                  <div className="flex items-center gap-3 rounded-xl bg-slate-100/80 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 px-4 py-3">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-300 dark:bg-slate-600 text-[10px] font-bold text-slate-700 dark:text-slate-200">=</div>
                    <span className="flex-1 text-sm font-semibold text-[var(--color-text)]">Costo Total Interno</span>
                    <span className="text-sm font-bold tabular-nums">{formatC(calcResult.totalInternalCost)}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <div className="rounded-xl bg-white/80 border border-slate-200 p-3">
                      <p className="text-[10px] font-bold uppercase text-slate-500">Precio minimo rentable</p>
                      <p className="text-sm font-bold text-slate-900">{formatC(calcResult.minPrice)}</p>
                    </div>
                    <div className="rounded-xl bg-white/80 border border-slate-200 p-3">
                      <p className="text-[10px] font-bold uppercase text-slate-500">Precio maximo de mercado</p>
                      <p className="text-sm font-bold text-slate-900">{calcResult.maxPrice === null ? "Sin limite" : formatC(calcResult.maxPrice)}</p>
                    </div>
                  </div>

                  {/* Step 6: Margen */}
                  <div className="flex items-center gap-3 rounded-xl bg-[var(--color-info-50)]/60 dark:bg-indigo-900/10 px-4 py-3">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-200 dark:bg-indigo-800 text-[10px] font-bold text-[var(--color-master-700)] dark:text-indigo-300">÷</div>
                    <span className="flex-1 text-sm text-[var(--color-master-700)] dark:text-[var(--color-master-400)]">÷ (1 − {calcResult.marginPercent}%)</span>
                    <span className="text-sm font-semibold tabular-nums text-[var(--color-master-700)] dark:text-[var(--color-master-400)]">
                      × {(1 / (1 - calcResult.marginPercent / 100)).toFixed(4)}
                    </span>
                  </div>
                </div>

                {/* ── Separador vertical ── */}
                <div className="hidden lg:flex flex-col items-center justify-center self-stretch py-8">
                  <div className="w-px flex-1 bg-gradient-to-b from-transparent via-emerald-300 dark:via-emerald-700 to-transparent" />
                  <div className="my-3 flex items-center justify-center w-10 h-10 rounded-full bg-[var(--color-success-50)] dark:bg-emerald-900/30 border-2 border-[var(--color-success-200)] dark:border-emerald-800">
                    <ArrowRight className="h-4 w-4 text-[var(--color-success-700)] dark:text-emerald-400" />
                  </div>
                  <div className="w-px flex-1 bg-gradient-to-b from-transparent via-emerald-300 dark:via-emerald-700 to-transparent" />
                </div>

                {/* ── Resultado final prominente ── */}
                <div className="flex flex-col items-center justify-center text-center lg:py-4">
                  {/* Precio sugerido grande */}
                  <div className="relative">
                    <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-emerald-400/20 to-teal-400/20 blur-2xl" />
                    <div className="relative rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-2xl shadow-emerald-500/30 px-10 py-8">
                      <p className="text-emerald-100 text-xs font-semibold uppercase tracking-widest mb-2">
                        Precio Sugerido
                      </p>
                      <p className="text-4xl lg:text-5xl font-extrabold text-white tracking-tight">
                        {formatC(calcResult.suggestedPrice)}
                      </p>
                      <div className="mt-3 pt-3 border-t border-white/20">
                        <p className="text-emerald-100 text-xs">
                          Ganancia por unidad
                        </p>
                        <p className="text-white font-bold text-lg mt-0.5">
                          {formatC(ganancia)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* KPIs debajo del precio */}
                  <div className="grid grid-cols-2 gap-3 mt-6 w-full max-w-xs">
                    <div className="rounded-xl bg-white/90 dark:bg-[var(--color-surface)]/5 border border-slate-300 dark:border-slate-700 p-3 text-center shadow-sm">
                      <p className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Margen real</p>
                      <p className="text-lg font-bold text-[var(--color-master-600)] dark:text-[var(--color-master-400)]">{calcResult.grossMarginPercent.toFixed(1)}%</p>
                    </div>
                    <div className="rounded-xl bg-white/90 dark:bg-[var(--color-surface)]/5 border border-slate-300 dark:border-slate-700 p-3 text-center shadow-sm">
                      <p className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Markup</p>
                      <p className="text-lg font-bold text-teal-600 dark:text-teal-400">{gananciaPercent}%</p>
                    </div>
                    <div className="rounded-xl bg-white/90 dark:bg-[var(--color-surface)]/5 border border-slate-300 dark:border-slate-700 p-3 text-center shadow-sm">
                      <p className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Gastos/mes</p>
                      <p className="text-xs font-bold text-[var(--color-text)]">{formatC(calcResult.totalMonthlyExpenses)}</p>
                    </div>
                    <div className="rounded-xl bg-white/90 dark:bg-[var(--color-surface)]/5 border border-slate-300 dark:border-slate-700 p-3 text-center shadow-sm">
                      <p className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Uds/mes</p>
                      <p className="text-xs font-bold text-[var(--color-text)]">{calcResult.estimatedMonthlyUnits.toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="mt-4 w-full max-w-xs rounded-xl border border-slate-200 bg-white/80 p-3 text-left text-xs text-slate-700">
                    <div className="flex justify-between"><span>Precio minimo crudo</span><strong>{formatC(calcResult.rawSuggestedPrice)}</strong></div>
                    <div className="flex justify-between"><span>Redondeo</span><strong>{calcResult.roundingRule}</strong></div>
                    <div className="flex justify-between"><span>Piso aplicado</span><strong>{calcResult.priceFloorReason}</strong></div>
                    <div className="flex justify-between"><span>Ambito gasto</span><strong>{calcResult.expenseScopeLabel}</strong></div>
                    <div className="flex justify-between"><span>Unidades usadas</span><strong>{calcResult.unitsUsedForProration.toLocaleString()}</strong></div>
                    <div className="flex justify-between"><span>Fuente gasto</span><strong>{calcResult.operatingExpenseSource}</strong></div>
                    {calcResult.expenseAllocationRatio !== undefined ? (
                      <div className="flex justify-between"><span>Participacion valor</span><strong>{(calcResult.expenseAllocationRatio * 100).toFixed(1)}%</strong></div>
                    ) : null}
                  </div>

                  {calcResult.includeTaxInCost && iva > 0 && (
                    <p className="mt-4 text-[10px] text-[var(--color-text-muted)] flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3" />
                      IVA ({iva}%) incluido en el costo de compra
                    </p>
                  )}

                  {productContext ? (
                    <div className="mt-5 w-full max-w-xs space-y-2 text-left">
                      {/* Fase 2 — alcance: una sucursal, varias elegidas, o todas las activas */}
                      <div className="flex rounded-lg border border-slate-300 p-0.5 text-xs dark:border-slate-700">
                        {([
                          { value: "BRANCH" as const, label: "Esta sucursal" },
                          { value: "SELECTED_BRANCHES" as const, label: "Elegir sucursales" },
                          { value: "ALL_BRANCHES" as const, label: "Todas" },
                        ]).map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => { setApplyScope(opt.value); setApplyPreview(null); }}
                            className={`flex-1 rounded-md px-2 py-1 font-medium transition-colors ${applyScope === opt.value ? "bg-[var(--color-master-600)] text-white" : "text-[var(--color-text-muted)]"}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      {applyScope === "SELECTED_BRANCHES" && (
                        <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                          {branches.map((b) => (
                            <label key={b.id} className="flex items-center gap-2 text-xs text-[var(--color-text)]">
                              <input
                                type="checkbox"
                                checked={selectedApplyBranchIds.includes(b.id)}
                                onChange={(e) => {
                                  setSelectedApplyBranchIds((prev) => (e.target.checked ? [...prev, b.id] : prev.filter((id) => id !== b.id)));
                                  setApplyPreview(null);
                                }}
                              />
                              {b.name}
                            </label>
                          ))}
                        </div>
                      )}

                      <Button className="w-full disabled:cursor-not-allowed disabled:opacity-50" variant="success" disabled={cannotApplyPrice} loading={previewLoading} onClick={() => void handlePreviewApply()}>
                        {applyScope === "BRANCH" ? "Aplicar a sucursal" : "Previsualizar aplicación"}
                      </Button>
                      {cannotApplyPrice && (
                        <p className="text-xs text-red-700">
                          Aplicacion bloqueada: {calcResult.applyBlockReason ?? "revisa costos, ambito de prorrateo o mercado"}.
                        </p>
                      )}
                    </div>
                  ) : calcMode === "ADVANCED" ? (
                    <p className="mt-5 max-w-xs text-xs text-[var(--color-text-muted)]">
                      Carga un producto para aplicar este precio al catalogo real.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* §2.3 — previsualización antes de confirmar: aplicar precios en lote es irreversible en la práctica */}
      {applyPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Confirmar cambio de precio</h3>
              <Button type="button" variant="ghost" size="sm" onClick={() => setApplyPreview(null)} disabled={applying}>Cerrar</Button>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--color-border)]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] text-left text-[var(--color-text-muted)]">
                    <th className="px-2 py-1.5">Sucursal</th>
                    <th className="px-2 py-1.5 text-right">Precio actual</th>
                    <th className="px-2 py-1.5 text-right">Precio nuevo</th>
                    <th className="px-2 py-1.5 text-right">Margen resultante</th>
                  </tr>
                </thead>
                <tbody>
                  {applyPreview.map((row) => (
                    <tr key={row.branchId} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-2 py-1.5 text-[var(--color-text)]">{row.branchName}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{row.previousPrice === null ? "Sin precio" : formatC(row.previousPrice)}</td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums text-[var(--color-success-700)]">{formatC(row.newPrice)}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${row.belowMinMargin ? "font-semibold text-[var(--color-warning-700)]" : ""}`}>
                        {row.marginPercent === null ? "—" : `${row.marginPercent.toFixed(1)}%`}
                        {row.belowMinMargin && row.minMarginPercent !== null && (
                          <span className="ml-1 inline-flex items-center gap-0.5 text-[var(--color-warning-700)]" title={`Bajo el mínimo de política (${row.minMarginPercent.toFixed(1)}%)`}>
                            <AlertTriangle className="h-3 w-3" />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {applyPreview.some((r) => r.belowMinMargin) && (
              <p className="flex items-start gap-1.5 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Al menos una sucursal queda con margen bajo su política mínima. No se bloquea — puede ser una decisión comercial deliberada — pero revisá antes de confirmar.</span>
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setApplyPreview(null)} disabled={applying}>Cancelar</Button>
              <Button type="button" variant="success" loading={applying} onClick={() => void handleConfirmApply()}>
                Confirmar {applyPreview.length > 1 ? `(${applyPreview.length} sucursales)` : ""}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Alertas comerciales ── */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-[var(--color-text)]">Alertas comerciales</h4>
            <p className="text-xs text-[var(--color-text-muted)]">Pricing, costo, margen, stock y riesgo ABC-XYZ por sucursal.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={loadCommercialAlerts} icon={<AlertTriangle className="h-4 w-4" />}>
            Cargar alertas
          </Button>
        </div>
        {commercialAlerts.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-3">Producto</th>
                  <th className="py-2 pr-3">Clase</th>
                  <th className="py-2 pr-3">Margen</th>
                  <th className="py-2 pr-3">Stock</th>
                  <th className="py-2 pr-3">Alerta</th>
                  <th className="py-2 pr-3">Accion</th>
                </tr>
              </thead>
              <tbody>
                {commercialAlerts.map((alert, index) => (
                  <tr key={`${alert.productId}-${alert.message}-${index}`} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-3">
                      <div className="font-semibold text-slate-900">{alert.sku}</div>
                      <div className="text-slate-600">{alert.name}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`rounded px-2 py-1 font-bold ${
                        alert.severity === "DANGER" ? "bg-red-100 text-red-700" : alert.severity === "WARNING" ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"
                      }`}>
                        {alert.combinedClass}
                      </span>
                      <div className="mt-1 text-slate-500">{alert.riskLevel}</div>
                    </td>
                    <td className="py-2 pr-3">{alert.grossMarginPercent === null ? "N/A" : `${alert.grossMarginPercent.toFixed(1)}%`}</td>
                    <td className="py-2 pr-3">{alert.stockOnHand.toLocaleString()}</td>
                    <td className="py-2 pr-3">{alert.message}</td>
                    <td className="py-2 pr-3">{alert.recommendedAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">Sin alertas cargadas.</p>
        )}
      </Card>

      <details className="group rounded-2xl border border-slate-200 dark:border-slate-700 bg-[var(--color-surface)] overflow-hidden">
        <summary className="flex items-center gap-3 cursor-pointer px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors select-none">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--color-info-50)] dark:bg-blue-900/30">
            <Info className="h-4 w-4 text-[var(--color-info-700)] dark:text-blue-400" />
          </div>
          <div className="flex-1">
            <h5 className="text-sm font-semibold text-[var(--color-text)]">¿Cómo se calcula el precio?</h5>
            <p className="text-[11px] text-[var(--color-text-muted)]">Fórmula completa con ejemplo paso a paso</p>
          </div>
          <ChevronDown className="h-4 w-4 text-[var(--color-text-muted)] transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-6 pb-6 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Fórmula */}
            <div className="space-y-3">
              <h6 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-info-700)] dark:text-blue-400">Fórmula</h6>
              <div className="space-y-2">
                {[
                  { step: "1", color: "amber", formula: "Costo Real = Costo Base × (1 + IVA/100)", note: "IVA sobre el costo" },
                  { step: "2", color: "rose", formula: "Gasto/Unidad = Gastos Mensuales ÷ Unidades", note: "Prorrateo de gastos fijos" },
                  { step: "3", color: "slate", formula: "Costo Total = Costo Real + Gasto/Unidad", note: "Costo completo por unidad" },
                  { step: "4", color: "emerald", formula: "Precio = Costo Total ÷ (1 − Margen/100)", note: "Precio con margen incluido" },
                ].map((item) => (
                  <div key={item.step} className="flex items-start gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 p-3">
                    <div className={`flex items-center justify-center w-6 h-6 rounded-full bg-${item.color}-200 dark:bg-${item.color}-800 text-[10px] font-bold text-${item.color}-700 dark:text-${item.color}-300 flex-shrink-0 mt-0.5`} style={{
                      backgroundColor: item.color === "amber" ? "#fde68a" : item.color === "rose" ? "#fecdd3" : item.color === "slate" ? "#cbd5e1" : "#a7f3d0",
                      color: item.color === "amber" ? "#92400e" : item.color === "rose" ? "#9f1239" : item.color === "slate" ? "#334155" : "#065f46",
                    }}>
                      {item.step}
                    </div>
                    <div>
                      <p className="text-xs font-mono font-semibold text-[var(--color-text)]">{item.formula}</p>
                      <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{item.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Ejemplo */}
            <div className="space-y-3">
              <h6 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-success-700)] dark:text-emerald-400">Ejemplo Práctico</h6>
              <div className="rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800/60 dark:to-slate-800/30 border border-slate-200 dark:border-slate-700 p-4 space-y-2 font-mono text-xs">
                <p className="text-[var(--color-text-muted)]"><span className="text-[var(--color-text)] font-semibold">Cemento</span> — Costo base: C$400</p>
                <div className="border-t border-slate-200 dark:border-slate-700 pt-2 space-y-1">
                  <p><span className="text-[var(--color-warning-700)] font-semibold">①</span> C$400 × 1.15 = <strong className="text-[var(--color-text)]">C$460.00</strong> <span className="text-[10px] text-[var(--color-text-muted)]">(+IVA 15%)</span></p>
                  <p><span className="text-rose-600 font-semibold">②</span> C$50,000 ÷ 1,000 = <strong className="text-[var(--color-text)]">C$50.00</strong> <span className="text-[10px] text-[var(--color-text-muted)]">(gasto/ud)</span></p>
                  <p><span className="text-slate-600 font-semibold">③</span> C$460 + C$50 = <strong className="text-[var(--color-text)]">C$510.00</strong> <span className="text-[10px] text-[var(--color-text-muted)]">(costo total)</span></p>
                  <div className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-2">
                    <p><span className="text-[var(--color-success-700)] font-semibold">④</span> C$510 ÷ (1 − 0.07) = <strong className="text-[var(--color-success-700)] dark:text-emerald-400 text-base">C$548.39</strong></p>
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Margen del 7% — Ganancia: C$38.39/ud</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
