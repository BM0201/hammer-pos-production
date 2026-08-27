"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  DollarSign,
  PieChart,
  Calculator,
  Building2,
  Settings,
  TrendingUp,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Sparkles,
  BadgeDollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import {
  type Branch,
  type Expense,
  type ExpenseSummary,
  type AllBranchesSummary,
  type PricingConfig,
  type InternalFreightRoute,
  type Truck,
  type TransferOption,
  type InternalFreightTrip,
  type ExpenseManagerTab,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  CATEGORY_COLORS,
  CATEGORIES,
  FREIGHT_STATUS_LABELS,
} from "@/components/expenses/expense-manager.types";
import { PricingCalculatorPanel } from "@/components/pricing/pricing-calculator-panel";
import { CategoryPoliciesPanel } from "@/components/pricing/category-policies-panel";

/**
 * TODO(finance-extract): la lógica de este componente se reutiliza dentro de
 * Finanzas & Contabilidad (FinanceAccountingManager) vía `forcedTab` + `hideTabBar`,
 * para servir un solo tab a la vez (Gastos, Fletes) sin duplicar código.
 *
 * Fase 1 (prompt-mudanza-zona-precios.md) — Precios y Políticas por categoría
 * se movieron a components/pricing/*-panel.tsx (mudanza, no reescritura: el
 * comportamiento de esos dos tabs es idéntico, solo cambió dónde vive el
 * código y de dónde saca sus datos — ya no comparten `selectedBranchId` ni
 * el resto del estado de Gastos).
 */

/** Historial por categoría del presupuesto inteligente (GET /api/finance/expense-history). */
type ExpenseCategoryStats = {
  category: string;
  last: { amount: number; date: string; description: string } | null;
  monthlyAverage: number;
  typicalAmount: number;
  suggestedBudget: number;
  sampleSize: number;
};

export function ExpenseManager({
  forcedTab,
  hideTabBar = false,
}: { forcedTab?: ExpenseManagerTab; hideTabBar?: boolean } = {}) {
  /* ── State ── */
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [allSummary, setAllSummary] = useState<AllBranchesSummary | null>(null);
  // "all" = vista consolidada de solo lectura; registrar/editar exige sucursal.
  const isAllBranches = selectedBranchId === "all";
  const [pricingConfig, setPricingConfig] = useState<PricingConfig | null>(null);
  const [expenseHistory, setExpenseHistory] = useState<ExpenseCategoryStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [internalTab, setInternalTab] = useState<ExpenseManagerTab>(forcedTab ?? "expenses");
  // Cuando el contenedor (Finanzas) fija un tab, este componente lo respeta y oculta su barra.
  const activeTab: ExpenseManagerTab = forcedTab ?? internalTab;
  const setActiveTab = setInternalTab;

  /* Form state */
  const [newExpense, setNewExpense] = useState({
    category: "OTHER",
    description: "",
    amount: "",
  });

  /* Internal freight */
  const [freightRoutes, setFreightRoutes] = useState<InternalFreightRoute[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [freightTrips, setFreightTrips] = useState<InternalFreightTrip[]>([]);
  const [transfers, setTransfers] = useState<TransferOption[]>([]);
  const [routeForm, setRouteForm] = useState({ originBranchId: "", destinationBranchId: "", name: "", roundTripKm: "", defaultAllocationMethod: "BY_VALUE" });
  const [truckForm, setTruckForm] = useState({ name: "", plate: "", fuelEfficiencyKmPerGallon: "", maintenanceCostPerKm: "0" });
  const [tripForm, setTripForm] = useState({ routeId: "", transferId: "", truckId: "", fuelPricePerGallon: "", fuelCost: "", driverCost: "0", helperCost: "0", otherCost: "0", allocationMethod: "BY_VALUE" });

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  /* ── Load branches ── */
  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((raw) => {
        const data = unwrapApiData(raw);
        const list = Array.isArray(data) ? data : [];
        setBranches(list);
        if (list.length > 0 && !selectedBranchId) {
          setSelectedBranchId(list[0].id);
        }
      })
      .catch(console.error);
  }, [selectedBranchId]);

  /* ── Load data when branch changes ── */
  const loadBranchData = useCallback(async () => {
    if (!selectedBranchId) return;
    if (selectedBranchId === "all") {
      setLoading(true);
      try {
        // El presupuesto inteligente también aplica a la vista consolidada:
        // historial global (todas las sucursales) sin branchId.
        const [res, histRes] = await Promise.all([
          fetch(`/api/expenses?branchId=all&summary=true`),
          fetch(`/api/finance/expense-history`),
        ]);
        setAllSummary(unwrapApiData(await res.json()));
        const histData = unwrapApiData(await histRes.json()) as { categories?: ExpenseCategoryStats[] } | null;
        setExpenseHistory(Array.isArray(histData?.categories) ? histData.categories : []);
        setExpenses([]);
        setSummary(null);
        setPricingConfig(null);
      } catch (e) {
        console.error("Error loading consolidated expenses:", e);
      } finally {
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    try {
      const [expRes, sumRes, cfgRes, histRes] = await Promise.all([
        fetch(`/api/expenses?branchId=${selectedBranchId}`),
        fetch(`/api/expenses?branchId=${selectedBranchId}&summary=true`),
        fetch(`/api/pricing/config?branchId=${selectedBranchId}`),
        fetch(`/api/finance/expense-history?branchId=${selectedBranchId}`),
      ]);
      const expData = unwrapApiData(await expRes.json());
      const sumData = unwrapApiData(await sumRes.json());
      const cfgData = unwrapApiData(await cfgRes.json());
      const histData = unwrapApiData(await histRes.json()) as { categories?: ExpenseCategoryStats[] } | null;

      setExpenses(expData);
      setSummary(sumData);
      setPricingConfig(cfgData);
      setExpenseHistory(Array.isArray(histData?.categories) ? histData.categories : []);
    } catch (e) {
      console.error("Error loading branch data:", e);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId]);

  useEffect(() => {
    loadBranchData();
  }, [loadBranchData]);

  const loadFreightData = useCallback(async () => {
    try {
      const [routesRes, trucksRes, tripsRes, transfersRes] = await Promise.all([
        fetch("/api/internal-freight/routes"),
        fetch("/api/internal-freight/trucks"),
        fetch("/api/internal-freight/trips"),
        fetch("/api/master/transfers"),
      ]);
      const routesData = unwrapApiData(await routesRes.json());
      const trucksData = unwrapApiData(await trucksRes.json());
      const tripsData = unwrapApiData(await tripsRes.json());
      const transfersData = unwrapApiData(await transfersRes.json());
      setFreightRoutes(Array.isArray(routesData) ? routesData : []);
      setTrucks(Array.isArray(trucksData) ? trucksData : []);
      setFreightTrips(Array.isArray(tripsData) ? tripsData : []);
      setTransfers(Array.isArray(transfersData) ? transfersData : []);
    } catch {
      showToast("error", "Error al cargar flete interno");
    }
  }, []);

  useEffect(() => {
    if (activeTab === "freight") loadFreightData();
  }, [activeTab, loadFreightData]);

  /* ── Handlers ── */

  const handleCreateExpense = async () => {
    if (!newExpense.description || !newExpense.amount || !selectedBranchId) return;
    try {
      const res = await apiFetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: selectedBranchId,
          category: newExpense.category,
          description: newExpense.description,
          amount: parseFloat(newExpense.amount),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Failed to create expense");
      }
      setNewExpense({ category: "OTHER", description: "", amount: "" });
      showToast("success", "Gasto registrado correctamente");
      loadBranchData();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Error al registrar gasto");
      console.error(e);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (!confirm("¿Desactivar este gasto?")) return;
    try {
      await apiFetch(`/api/expenses/${id}`, { method: "DELETE" });
      showToast("success", "Gasto desactivado");
      loadBranchData();
    } catch (e) {
      showToast("error", "Error al desactivar gasto");
      console.error(e);
    }
  };

  const handleCreateRoute = async () => {
    const res = await apiFetch("/api/internal-freight/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...routeForm, roundTripKm: Number(routeForm.roundTripKm) }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      showToast("error", body?.error?.message ?? "No se pudo crear la ruta");
      return;
    }
    setRouteForm({ originBranchId: "", destinationBranchId: "", name: "", roundTripKm: "", defaultAllocationMethod: "BY_VALUE" });
    showToast("success", "Ruta de flete creada");
    loadFreightData();
  };

  const handleCreateTruck = async () => {
    const res = await apiFetch("/api/internal-freight/trucks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: truckForm.name,
        plate: truckForm.plate || null,
        fuelEfficiencyKmPerGallon: truckForm.fuelEfficiencyKmPerGallon ? Number(truckForm.fuelEfficiencyKmPerGallon) : null,
        maintenanceCostPerKm: Number(truckForm.maintenanceCostPerKm || 0),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      showToast("error", body?.error?.message ?? "No se pudo crear el camion");
      return;
    }
    setTruckForm({ name: "", plate: "", fuelEfficiencyKmPerGallon: "", maintenanceCostPerKm: "0" });
    showToast("success", "Camion creado");
    loadFreightData();
  };

  const handleCreateTrip = async () => {
    const res = await apiFetch("/api/internal-freight/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeId: tripForm.routeId,
        transferId: tripForm.transferId || null,
        truckId: tripForm.truckId || null,
        fuelPricePerGallon: Number(tripForm.fuelPricePerGallon || 0),
        fuelCost: tripForm.fuelCost ? Number(tripForm.fuelCost) : null,
        driverCost: Number(tripForm.driverCost || 0),
        helperCost: Number(tripForm.helperCost || 0),
        otherCost: Number(tripForm.otherCost || 0),
        allocationMethod: tripForm.allocationMethod,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      showToast("error", body?.error?.message ?? "No se pudo calcular el viaje");
      return;
    }
    showToast("success", "Viaje de flete calculado");
    loadFreightData();
  };

  const handleApplyTrip = async (id: string) => {
    if (!confirm("Aplicar este flete al costo por sucursal? No movera inventario ni cambiara precios automaticamente.")) return;
    const res = await apiFetch(`/api/internal-freight/trips/${id}/apply`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      showToast("error", body?.error?.message ?? "No se pudo aplicar el flete");
      return;
    }
    showToast("success", "Flete aplicado al costo de sucursal");
    loadFreightData();
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const formatC = (n: number) =>
    `C$${n.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  /* ── Selected branch name ── */
  const selectedBranch = branches.find((b) => b.id === selectedBranchId);

  /* ══════════════════════════════════════════════════════════════ */

  return (
    <div className="space-y-6">
      {/* ── Branch Selector ── */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-[var(--color-text-muted)]" />
          <select
            className="w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-[var(--color-text)] focus:ring-2 focus:ring-[var(--color-info-500)] focus:border-[var(--color-info-500)] transition-colors min-h-[44px] min-w-[200px]"
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
          >
            <option value="">Seleccionar sucursal...</option>
            <option value="all">Todas las sucursales (consolidado)</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} · {b.name}
              </option>
            ))}
          </select>
        </div>
        <Button variant="secondary" size="sm" onClick={loadBranchData} icon={<RefreshCw className="h-4 w-4" />}>
          Actualizar
        </Button>
      </div>

      {/* ── Summary Cards (sucursal específica) ── */}
      {summary && selectedBranchId && !isAllBranches && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[var(--color-danger-50)]">
                <DollarSign className="h-5 w-5 text-[var(--color-danger-600)]" />
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)] font-medium">Gastos Mensuales</p>
                <p className="text-xl font-bold text-[var(--color-text)]">
                  {formatC(summary.grandTotal)}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[var(--color-info-50)]">
                <PieChart className="h-5 w-5 text-[var(--color-info-600)]" />
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)] font-medium">Categorías Activas</p>
                <p className="text-xl font-bold text-[var(--color-text)]">
                  {Object.keys(summary.byCategory).length}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[var(--color-success-50)]">
                <TrendingUp className="h-5 w-5 text-[var(--color-success-600)]" />
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)] font-medium">Margen Configurado</p>
                <p className="text-xl font-bold text-[var(--color-text)]">
                  {pricingConfig && pricingConfig.id
                    ? `${Number(pricingConfig.desiredMarginPercent)}%`
                    : "Sin configurar"}
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── Tabs ── (ocultas cuando Finanzas controla el tab) */}
      {!hideTabBar && (
      <div className="flex gap-1 bg-[var(--color-surface-raised)] rounded-lg p-1 overflow-x-auto">
        {(["expenses", "pricing", "policies", "freight"] as const).map((tab) => {
          const labels = {
            expenses: { label: "Gastos Operativos", icon: DollarSign },
            pricing: { label: "Precios", icon: Calculator },
            policies: { label: "Politicas por categoria", icon: Settings },
            freight: { label: "Flete interno", icon: TrendingUp },
          };
          const { label, icon: Icon } = labels[tab];
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all
                ${activeTab === tab
                  ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline whitespace-nowrap">{label}</span>
            </button>
          );
        })}
      </div>
      )}

      {loading && (
        <div className="text-center py-8 text-[var(--color-text-muted)]">
          Cargando datos...
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* VISTA CONSOLIDADA: TODAS LAS SUCURSALES (solo lectura) */}
      {/* ══════════════════════════════════════════════════════════ */}
      {activeTab === "expenses" && isAllBranches && !loading && allSummary && (
        <div className="space-y-4">
          <div className="hm-alert hm-alert-info text-xs">
            Vista consolidada de solo lectura — para registrar, editar o borrar un gasto, selecciona una sucursal específica.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[var(--color-danger-50)]">
                  <DollarSign className="h-5 w-5 text-[var(--color-danger-600)]" />
                </div>
                <div>
                  <p className="text-xs text-[var(--color-text-muted)] font-medium">Gasto total (todas)</p>
                  <p className="text-xl font-bold text-[var(--color-text)]">{formatC(allSummary.grandTotal)}</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[var(--color-info-50)]">
                  <Building2 className="h-5 w-5 text-[var(--color-info-600)]" />
                </div>
                <div>
                  <p className="text-xs text-[var(--color-text-muted)] font-medium">Sucursales con gasto</p>
                  <p className="text-xl font-bold text-[var(--color-text)]">
                    {allSummary.branchesWithExpenses} de {allSummary.totalBranches}
                  </p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[var(--color-warning-50)]">
                  <PieChart className="h-5 w-5 text-[var(--color-warning-600)]" />
                </div>
                <div>
                  <p className="text-xs text-[var(--color-text-muted)] font-medium">Categoría mayor</p>
                  <p className="text-xl font-bold text-[var(--color-text)]">
                    {allSummary.topCategory ? (CATEGORY_LABELS[allSummary.topCategory] ?? allSummary.topCategory) : "—"}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <h4 className="text-sm font-semibold text-[var(--color-text)] mb-3">Desglose por sucursal</h4>
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                    <th className="py-1.5 pr-3">Sucursal</th>
                    <th className="py-1.5 pr-3 text-right">Nómina</th>
                    <th className="py-1.5 pr-3 text-right">Fijos (renta, servicios)</th>
                    <th className="py-1.5 pr-3 text-right">Otros</th>
                    <th className="py-1.5 pr-3 text-right">Total</th>
                    <th className="py-1.5">% del total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {allSummary.byBranch.map((b) => {
                    const payroll = b.byCategory.PAYROLL ?? 0;
                    const fixed = (b.byCategory.RENT ?? 0) + (b.byCategory.UTILITIES ?? 0);
                    const other = Math.max(0, b.total - payroll - fixed);
                    const maxTotal = allSummary.byBranch[0]?.total || 1;
                    return (
                      <tr key={b.branchId}>
                        <td className="py-2 pr-3 font-semibold whitespace-nowrap text-[var(--color-text)]">
                          {b.branchCode} <span className="font-normal text-[var(--color-text-muted)]">{b.branchName}</span>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatC(payroll)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatC(fixed)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatC(other)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums font-bold text-[var(--color-text)]">{formatC(b.total)}</td>
                        <td className="py-2">
                          <div className="h-2 w-24 rounded-full bg-[var(--color-surface-alt)] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[var(--color-info-500)]"
                              style={{ width: `${Math.round((b.total / maxTotal) * 100)}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Presupuesto inteligente consolidado (todas las sucursales) — el
              mismo historial real, en global. Para aplicar un sugerido como
              presupuesto se elige la sucursal (los presupuestos viven por
              sucursal), por eso aquí es solo lectura. */}
          {expenseHistory.length > 0 && (
            <Card className="p-5">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  <Sparkles className="h-4 w-4 text-[var(--color-info-600)]" />
                  Presupuesto inteligente · todas las sucursales
                </h4>
                <span className="text-[0.6875rem] text-[var(--color-text-muted)]">
                  Últimos 6 meses de gastos pagados desde caja — para aplicar un sugerido, elige la sucursal
                </span>
              </div>
              <div className="min-w-0 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                      <th className="py-1.5 pr-3">Categoría</th>
                      <th className="py-1.5 pr-3">Último gasto</th>
                      <th className="py-1.5 pr-3 text-right">Promedio mensual</th>
                      <th className="py-1.5 text-right">Presupuesto sugerido</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {expenseHistory.map((c) => (
                      <tr key={c.category}>
                        <td className="py-2 pr-3 font-semibold whitespace-nowrap text-[var(--color-text)]">
                          {CATEGORY_ICONS[c.category] ?? ""} {CATEGORY_LABELS[c.category] ?? c.category}
                        </td>
                        <td className="py-2 pr-3">
                          {c.last ? (
                            <>
                              <span className="font-bold tabular-nums text-[var(--color-text)]">{formatC(c.last.amount)}</span>
                              <span className="ml-1.5 text-[var(--color-text-muted)]">
                                {new Date(c.last.date).toLocaleDateString("es-NI", { day: "numeric", month: "short", timeZone: "UTC" })} · {c.last.description}
                              </span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatC(c.monthlyAverage)}</td>
                        <td className="py-2 text-right font-bold tabular-nums text-[var(--color-info-700)]">
                          {c.suggestedBudget > 0 ? formatC(c.suggestedBudget) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* En modo consolidado, los tabs que editan por sucursal piden elegir una. */}
      {isAllBranches && !loading && (activeTab === "pricing" || activeTab === "policies") && (
        <div className="hm-alert hm-alert-info text-xs">
          Esta sección trabaja sobre una sucursal específica — selecciónala en el filtro de arriba.
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* TAB: GASTOS OPERATIVOS */}
      {/* ══════════════════════════════════════════════════════════ */}
      {activeTab === "expenses" && selectedBranchId && !isAllBranches && !loading && (
        <div className="space-y-6">
          {/* ── Create Expense Form ── */}
          <Card className="p-5">
            <h4 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Registrar Gasto Operativo
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <select
                className="w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-[var(--color-text)] focus:ring-2 focus:ring-[var(--color-info-500)] focus:border-[var(--color-info-500)] transition-colors min-h-[44px]"
                value={newExpense.category}
                onChange={(e) => setNewExpense((p) => ({ ...p, category: e.target.value }))}
              >
                {/* PAYROLL fuera: el costo laboral se sincroniza solo al
                    postear la nómina — registrarlo a mano lo duplicaría. */}
                {CATEGORIES.filter((cat) => cat !== "PAYROLL").map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Descripción"
                value={newExpense.description}
                onChange={(e) => setNewExpense((p) => ({ ...p, description: e.target.value }))}
              />
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Monto mensual (C$)"
                value={newExpense.amount}
                onChange={(e) => setNewExpense((p) => ({ ...p, amount: e.target.value }))}
              />
              <Button
                variant="primary"
                onClick={handleCreateExpense}
                disabled={!newExpense.description || !newExpense.amount}
                icon={<Plus className="h-4 w-4" />}
              >
                Agregar
              </Button>
              <div className="sm:col-span-4 rounded-lg border border-[var(--color-info-200)] bg-[var(--color-info-50)] px-3 py-2 text-xs text-[var(--color-info-700)]">
                Los prestamos a empleados no son gasto operativo; se recuperan via deduccion de nomina.
              </div>
            </div>
          </Card>

          {/* ── Presupuesto inteligente: el historial arma el presupuesto ──
              En vez de inventar un monto fijo, cada categoría muestra su
              ÚLTIMO gasto real y el promedio mensual de los últimos 6 meses;
              "Usar" precarga el formulario con el presupuesto sugerido. Los
              montos fuera de lo normal avisan solos al registrarse. */}
          {expenseHistory.length > 0 && (
            <Card className="p-5">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  <Sparkles className="h-4 w-4 text-[var(--color-info-600)]" />
                  Presupuesto inteligente · según tu historial real
                </h4>
                <span className="text-[0.6875rem] text-[var(--color-text-muted)]">
                  Últimos 6 meses de gastos pagados desde caja
                </span>
              </div>
              <p className="mb-3 text-xs text-[var(--color-text-muted)]">
                El presupuesto se arma con lo que de verdad gastas: aquí ves el último pago de cada categoría y su
                promedio mensual. Si un gasto nuevo se sale de los valores normales, el sistema avisa al registrarlo.
              </p>
              <div className="min-w-0 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                      <th className="py-1.5 pr-3">Categoría</th>
                      <th className="py-1.5 pr-3">Último gasto</th>
                      <th className="py-1.5 pr-3 text-right">Promedio mensual</th>
                      <th className="py-1.5 pr-3 text-right">Presupuesto sugerido</th>
                      <th className="py-1.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {expenseHistory.map((c) => (
                      <tr key={c.category}>
                        <td className="py-2 pr-3 font-semibold whitespace-nowrap text-[var(--color-text)]">
                          {CATEGORY_ICONS[c.category] ?? ""} {CATEGORY_LABELS[c.category] ?? c.category}
                        </td>
                        <td className="py-2 pr-3">
                          {c.last ? (
                            <>
                              <span className="font-bold tabular-nums text-[var(--color-text)]">{formatC(c.last.amount)}</span>
                              <span className="ml-1.5 text-[var(--color-text-muted)]">
                                {new Date(c.last.date).toLocaleDateString("es-NI", { day: "numeric", month: "short", timeZone: "UTC" })} · {c.last.description}
                              </span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatC(c.monthlyAverage)}</td>
                        <td className="py-2 pr-3 text-right font-bold tabular-nums text-[var(--color-info-700)]">
                          {c.suggestedBudget > 0 ? formatC(c.suggestedBudget) : "—"}
                        </td>
                        <td className="py-2 text-right">
                          {c.suggestedBudget > 0 && (
                            <Button
                              size="sm"
                              variant="secondary"
                              title="Precarga el formulario de arriba con este presupuesto — revisa y presiona Agregar"
                              onClick={() =>
                                setNewExpense({
                                  category: c.category,
                                  description: `Presupuesto ${CATEGORY_LABELS[c.category] ?? c.category} (según historial)`,
                                  amount: String(c.suggestedBudget),
                                })
                              }
                            >
                              Usar
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ── Costo laboral (planilla) — APARTE de los demás gastos ──
              Lo que cuesta tener a cada empleado (salario + INSS patronal +
              INATEC + prestaciones). Se sincroniza solo al postear la nómina;
              aquí es de solo lectura: se gestiona desde Finanzas › Planilla. */}
          {summary && (summary.byCategory.PAYROLL?.total ?? 0) > 0 && (
            <Card className="p-5" style={{ borderColor: "var(--color-owner-200)" }}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  <BadgeDollarSign className="h-4 w-4 text-[var(--color-owner-600)]" />
                  Costo laboral (planilla) · {selectedBranch?.name}
                </h4>
                <span className="text-lg font-bold text-[var(--color-owner-600)]">
                  {formatC(summary.byCategory.PAYROLL.total)}
                </span>
              </div>
              <p className="mb-3 text-xs text-[var(--color-text-muted)]">
                Lo que cuesta tener a cada empleado por mes: salario + INSS patronal + INATEC + prestaciones de ley.
                Se actualiza al postear la nómina; se gestiona en Finanzas › Planilla (aquí no se edita).
              </p>
              <div className="divide-y divide-[var(--color-neutral-100)] rounded-lg border border-[var(--color-neutral-100)]">
                {summary.byCategory.PAYROLL.items.map((exp) => (
                  <div key={exp.id} className="flex items-center justify-between px-4 py-2.5">
                    <p className="text-sm text-[var(--color-text)]">{exp.description}</p>
                    <span className="text-sm font-semibold tabular-nums text-[var(--color-text)]">
                      {formatC(Number(exp.amount))}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── Expense Distribution Chart (simple bar) ── */}
          {summary && summary.grandTotal > 0 && (
            <Card className="p-5">
              <h4 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
                <PieChart className="h-4 w-4" />
                Distribución de Gastos · {selectedBranch?.name}
              </h4>
              <div className="space-y-2">
                {Object.entries(summary.byCategory)
                  .sort(([, a], [, b]) => b.total - a.total)
                  .map(([cat, data]) => {
                    const pct = (data.total / summary.grandTotal) * 100;
                    return (
                      <div key={cat} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 font-medium text-[var(--color-text-secondary)]">
                            {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat] || cat}
                          </span>
                          <span className="text-[var(--color-text-muted)]">
                            {formatC(data.total)} ({pct.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="h-2 bg-[var(--color-neutral-100)] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: CATEGORY_COLORS[cat] || "#6b7280",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
              <div className="mt-4 pt-3 border-t border-[var(--color-neutral-100)] flex justify-between items-center">
                <span className="text-sm font-semibold text-[var(--color-text)]">Total Mensual</span>
                <span className="text-lg font-bold text-[var(--color-danger-600)]">{formatC(summary.grandTotal)}</span>
              </div>
            </Card>
          )}

          {/* ── Expense List by Category (la planilla vive en su sección aparte) ── */}
          {summary && (
            <div className="space-y-3">
              {Object.entries(summary.byCategory)
                .filter(([cat]) => cat !== "PAYROLL")
                .sort(([, a], [, b]) => b.total - a.total)
                .map(([cat, data]) => (
                  <Card key={cat} noPadding>
                    <button
                      onClick={() => toggleCategory(cat)}
                      className="w-full flex items-center justify-between px-5 py-3 hover:bg-[var(--color-neutral-50)] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: CATEGORY_COLORS[cat] }}
                        />
                        <span className="text-sm font-semibold text-[var(--color-text)]">
                          {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat] || cat}
                        </span>
                        <span className="text-xs text-[var(--color-text-muted)]">
                          ({data.count} {data.count === 1 ? "gasto" : "gastos"})
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-[var(--color-text)]">
                          {formatC(data.total)}
                        </span>
                        {expandedCategories.has(cat) ? (
                          <ChevronUp className="h-4 w-4 text-[var(--color-text-muted)]" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-[var(--color-text-muted)]" />
                        )}
                      </div>
                    </button>
                    {expandedCategories.has(cat) && (
                      <div className="border-t border-[var(--color-neutral-100)] divide-y divide-[var(--color-neutral-100)]">
                        {data.items.map((exp) => (
                          <div key={exp.id} className="flex items-center justify-between px-5 py-2.5">
                            <div>
                              <p className="text-sm text-[var(--color-text)]">{exp.description}</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-semibold text-[var(--color-text)]">
                                {formatC(Number(exp.amount))}
                              </span>
                              <button
                                onClick={() => handleDeleteExpense(exp.id)}
                                className="p-1.5 rounded-md text-[var(--color-danger-500)] hover:text-[var(--color-danger-600)] hover:bg-[var(--color-danger-50)] transition-colors"
                                title="Desactivar gasto"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                ))}
            </div>
          )}

          {expenses.length === 0 && !loading && (
            <div className="text-center py-12 text-[var(--color-text-muted)]">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No hay gastos registrados para esta sucursal.</p>
              <p className="text-xs mt-1">Usa el formulario de arriba para registrar gastos operativos.</p>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* TAB: PRECIOS — Fase 1 (prompt-mudanza-zona-precios.md): mudado a  */}
      {/* components/pricing/pricing-calculator-panel.tsx, sin cambiar     */}
      {/* comportamiento. Ya no comparte selectedBranchId ni el resto del  */}
      {/* estado con Gastos — recibe branchId por props.                  */}
      {/* ══════════════════════════════════════════════════════════ */}
      {activeTab === "pricing" && selectedBranchId && !isAllBranches && !loading && (
        <PricingCalculatorPanel branchId={selectedBranchId} onSaved={loadBranchData} />
      )}

      {/* Fase 1 (prompt-mudanza-zona-precios.md) — mudado a components/pricing/category-policies-panel.tsx. */}
      {activeTab === "policies" && selectedBranchId && !isAllBranches && !loading && (
        <CategoryPoliciesPanel branchId={selectedBranchId} />
      )}

      {activeTab === "freight" && !loading && (
        <div className="space-y-6">
          <Card className="p-4">
            <p className="text-sm text-[var(--color-text-secondary)]">
              El flete interno Managua - sucursal se suma al costo del producto en la sucursal destino. El transporte al cliente se cobra aparte en la venta.
            </p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5 space-y-3">
              <h4 className="text-sm font-semibold text-[var(--color-text)]">Configurar ruta</h4>
              <div className="grid gap-2 sm:grid-cols-2">
                <select className="rounded-lg border px-3 py-2 text-sm" value={routeForm.originBranchId} onChange={(e) => setRouteForm({ ...routeForm, originBranchId: e.target.value })}>
                  <option value="">Origen</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
                </select>
                <select className="rounded-lg border px-3 py-2 text-sm" value={routeForm.destinationBranchId} onChange={(e) => setRouteForm({ ...routeForm, destinationBranchId: e.target.value })}>
                  <option value="">Destino</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
                </select>
                <Input placeholder="Nombre de ruta" value={routeForm.name} onChange={(e) => setRouteForm({ ...routeForm, name: e.target.value })} />
                <Input type="number" min="0" step="0.01" placeholder="Km ida/vuelta" value={routeForm.roundTripKm} onChange={(e) => setRouteForm({ ...routeForm, roundTripKm: e.target.value })} />
                <select className="rounded-lg border px-3 py-2 text-sm" value={routeForm.defaultAllocationMethod} onChange={(e) => setRouteForm({ ...routeForm, defaultAllocationMethod: e.target.value })}>
                  <option value="BY_VALUE">Reparto por valor</option>
                  <option value="BY_QUANTITY">Reparto por cantidad</option>
                  <option value="MANUAL">Manual</option>
                </select>
                <Button onClick={handleCreateRoute} disabled={!routeForm.originBranchId || !routeForm.destinationBranchId || !routeForm.name || !routeForm.roundTripKm}>Crear ruta</Button>
              </div>
            </Card>

            <Card className="p-5 space-y-3">
              <h4 className="text-sm font-semibold text-[var(--color-text)]">Configurar camion</h4>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input placeholder="Nombre" value={truckForm.name} onChange={(e) => setTruckForm({ ...truckForm, name: e.target.value })} />
                <Input placeholder="Placa" value={truckForm.plate} onChange={(e) => setTruckForm({ ...truckForm, plate: e.target.value })} />
                <Input type="number" min="0" step="0.01" placeholder="Km/galon" value={truckForm.fuelEfficiencyKmPerGallon} onChange={(e) => setTruckForm({ ...truckForm, fuelEfficiencyKmPerGallon: e.target.value })} />
                <Input type="number" min="0" step="0.01" placeholder="Mantenimiento por km" value={truckForm.maintenanceCostPerKm} onChange={(e) => setTruckForm({ ...truckForm, maintenanceCostPerKm: e.target.value })} />
                <Button onClick={handleCreateTruck} disabled={!truckForm.name}>Crear camion</Button>
              </div>
            </Card>
          </div>

          <Card className="p-5 space-y-3">
            <h4 className="text-sm font-semibold text-[var(--color-text)]">Crear viaje de flete interno</h4>
            <div className="grid gap-2 md:grid-cols-4">
              <select className="rounded-lg border px-3 py-2 text-sm" value={tripForm.routeId} onChange={(e) => setTripForm({ ...tripForm, routeId: e.target.value })}>
                <option value="">Ruta</option>
                {freightRoutes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <select className="rounded-lg border px-3 py-2 text-sm" value={tripForm.transferId} onChange={(e) => setTripForm({ ...tripForm, transferId: e.target.value })}>
                <option value="">Transferencia (requerida)</option>
                {transfers.map((t) => <option key={t.id} value={t.id}>{t.transferNumber}</option>)}
              </select>
              <select className="rounded-lg border px-3 py-2 text-sm" value={tripForm.truckId} onChange={(e) => setTripForm({ ...tripForm, truckId: e.target.value })}>
                <option value="">Camion opcional</option>
                {trucks.map((t) => <option key={t.id} value={t.id}>{t.name}{t.plate ? ` - ${t.plate}` : ""}</option>)}
              </select>
              <select className="rounded-lg border px-3 py-2 text-sm" value={tripForm.allocationMethod} onChange={(e) => setTripForm({ ...tripForm, allocationMethod: e.target.value })}>
                <option value="BY_VALUE">Por valor</option>
                <option value="BY_QUANTITY">Por cantidad</option>
              </select>
              <Input type="number" min="0" step="0.01" placeholder="Precio combustible/galon" value={tripForm.fuelPricePerGallon} onChange={(e) => setTripForm({ ...tripForm, fuelPricePerGallon: e.target.value })} />
              <Input type="number" min="0" step="0.01" placeholder="Combustible manual si no hay camion" value={tripForm.fuelCost} onChange={(e) => setTripForm({ ...tripForm, fuelCost: e.target.value })} />
              <Input type="number" min="0" step="0.01" placeholder="Conductor" value={tripForm.driverCost} onChange={(e) => setTripForm({ ...tripForm, driverCost: e.target.value })} />
              <Input type="number" min="0" step="0.01" placeholder="Ayudante" value={tripForm.helperCost} onChange={(e) => setTripForm({ ...tripForm, helperCost: e.target.value })} />
              <Input type="number" min="0" step="0.01" placeholder="Otros costos" value={tripForm.otherCost} onChange={(e) => setTripForm({ ...tripForm, otherCost: e.target.value })} />
              <Button onClick={handleCreateTrip} disabled={!tripForm.routeId || !tripForm.transferId || !tripForm.fuelPricePerGallon}>Calcular viaje</Button>
            </div>
          </Card>

          <Card className="p-5">
            <h4 className="text-sm font-semibold text-[var(--color-text)] mb-3">Viajes calculados</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b text-left"><th>Ruta</th><th>Camion</th><th>Total</th><th>Estado</th><th>Lineas</th><th>Accion</th></tr></thead>
                <tbody>
                  {freightTrips.map((trip) => (
                    <tr key={trip.id} className="border-b align-top">
                      <td className="py-2">{trip.route.name}</td>
                      <td>{trip.truck?.name ?? "Manual"}</td>
                      <td>{formatC(Number(trip.totalTripCost))}</td>
                      <td>{FREIGHT_STATUS_LABELS[trip.status] ?? trip.status}</td>
                      <td>
                        <div className="space-y-1">
                          {trip.lines.slice(0, 5).map((line) => (
                            <div key={line.id}>{line.product.sku}: {formatC(Number(line.allocatedFreightPerUnit))}/u</div>
                          ))}
                        </div>
                      </td>
                      <td>
                        {trip.status !== "APPLIED" && (
                          <button className="text-[var(--color-info-700)] hover:underline" onClick={() => handleApplyTrip(trip.id)}>Aplicar a costo sucursal</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!freightTrips.length && <tr><td colSpan={6} className="py-6 text-center text-[var(--color-text-muted)]">Sin viajes de flete interno.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {!selectedBranchId && !loading && (
        <div className="text-center py-16 text-[var(--color-text-muted)]">
          <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Selecciona una sucursal para gestionar gastos operativos.</p>
        </div>
      )}
    </div>
  );
}
