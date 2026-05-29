"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  DollarSign,
  PieChart,
  Calculator,
  Building2,
  Save,
  Settings,
  TrendingUp,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

/* ── Types ── */

type Branch = { id: string; code: string; name: string };

type Expense = {
  id: string;
  branchId: string;
  category: string;
  description: string;
  amount: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  branch: Branch;
};

type ExpenseSummary = {
  byCategory: Record<string, { total: number; count: number; items: Expense[] }>;
  grandTotal: number;
  totalExpenses: number;
};

type PricingConfig = {
  id?: string;
  branchId: string;
  desiredMarginPercent: string | number;
  prorationMethod: string;
  estimatedMonthlyUnits: string | number;
  exists?: boolean;
  branch?: Branch;
};

type SuggestedPriceResult = {
  purchaseCost: number;
  operatingExpensePerUnit: number;
  totalCostPerUnit: number;
  marginPercent: number;
  suggestedPrice: number;
  totalMonthlyExpenses: number;
  estimatedMonthlyUnits: number;
  configExists: boolean;
};

type InternalFreightRoute = {
  id: string;
  name: string;
  originBranchId: string;
  destinationBranchId: string;
  roundTripKm: string;
  defaultAllocationMethod: string;
  isActive: boolean;
  originBranch: Branch;
  destinationBranch: Branch;
};

type Truck = {
  id: string;
  name: string;
  plate: string | null;
  fuelEfficiencyKmPerGallon: string | null;
  maintenanceCostPerKm: string;
  isActive: boolean;
};

type TransferOption = {
  id: string;
  transferNumber: string;
  fromBranchId: string;
  toBranchId: string;
};

type InternalFreightTrip = {
  id: string;
  status: string;
  fuelCost: string;
  maintenanceCost: string;
  totalTripCost: string;
  allocationMethod: string;
  route: InternalFreightRoute;
  truck: Truck | null;
  transfer: { id: string; transferNumber: string } | null;
  lines: Array<{
    id: string;
    quantity: string;
    lineValue: string;
    allocatedFreight: string;
    allocatedFreightPerUnit: string;
    product: { id: string; sku: string; name: string };
  }>;
};

/* ── Constants ── */

const CATEGORY_LABELS: Record<string, string> = {
  PAYROLL: "Personal / Nómina",
  UTILITIES: "Servicios (Agua, Luz, Internet)",
  RENT: "Renta / Alquiler",
  FOOD: "Alimentación",
  MAINTENANCE: "Mantenimiento",
  TRANSPORT: "Transporte",
  MARKETING: "Publicidad / Marketing",
  OTHER: "Otros",
};

const CATEGORY_ICONS: Record<string, string> = {
  PAYROLL: "NOM",
  UTILITIES: "SVC",
  RENT: "ALQ",
  FOOD: "ALM",
  MAINTENANCE: "MNT",
  TRANSPORT: "TRP",
  MARKETING: "MKT",
  OTHER: "OTR",
};

const CATEGORY_COLORS: Record<string, string> = {
  PAYROLL: "#6366f1",
  UTILITIES: "#f59e0b",
  RENT: "#ef4444",
  FOOD: "#22c55e",
  MAINTENANCE: "#8b5cf6",
  TRANSPORT: "#3b82f6",
  MARKETING: "#ec4899",
  OTHER: "#6b7280",
};

const CATEGORIES = Object.keys(CATEGORY_LABELS);

const FREIGHT_STATUS_LABELS: Record<string, string> = {
  CALCULATED: "Calculado",
  APPLIED: "Aplicado",
  CANCELLED: "Cancelado",
  DRAFT: "Borrador",
};

/* ══════════════════════════════════════════════════════════════ */

export function ExpenseManager() {
  /* ── State ── */
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [pricingConfig, setPricingConfig] = useState<PricingConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"expenses" | "pricing" | "freight">("expenses");

  /* Form state */
  const [newExpense, setNewExpense] = useState({
    category: "OTHER",
    description: "",
    amount: "",
  });

  /* Config form */
  const [configForm, setConfigForm] = useState({
    desiredMarginPercent: "30",
    estimatedMonthlyUnits: "1000",
    prorationMethod: "BY_QUANTITY",
  });

  /* Calculator state */
  const [calcCost, setCalcCost] = useState("");
  const [calcResult, setCalcResult] = useState<SuggestedPriceResult | null>(null);
  const [ivaPercent, setIvaPercent] = useState("15");

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
    setLoading(true);
    try {
      const [expRes, sumRes, cfgRes] = await Promise.all([
        fetch(`/api/expenses?branchId=${selectedBranchId}`),
        fetch(`/api/expenses?branchId=${selectedBranchId}&summary=true`),
        fetch(`/api/pricing/config?branchId=${selectedBranchId}`),
      ]);
      const expData = unwrapApiData(await expRes.json());
      const sumData = unwrapApiData(await sumRes.json());
      const cfgData = unwrapApiData(await cfgRes.json());

      setExpenses(expData);
      setSummary(sumData);
      setPricingConfig(cfgData);

      if (cfgData && cfgData.id) {
        setConfigForm({
          desiredMarginPercent: String(cfgData.desiredMarginPercent),
          estimatedMonthlyUnits: String(cfgData.estimatedMonthlyUnits),
          prorationMethod: cfgData.prorationMethod === "BY_VALUE" ? "BY_QUANTITY" : (cfgData.prorationMethod || "BY_QUANTITY"),
        });
      }
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
    if (newExpense.category === "PAYROLL") {
      showToast("error", "Los gastos de nómina deben sincronizarse desde Personal & Nómina para evitar doble conteo.");
      return;
    }
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

  const handleSaveConfig = async () => {
    if (!selectedBranchId) return;
    try {
      const res = await apiFetch("/api/pricing/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: selectedBranchId,
          desiredMarginPercent: parseFloat(configForm.desiredMarginPercent),
          estimatedMonthlyUnits: parseFloat(configForm.estimatedMonthlyUnits),
          prorationMethod: configForm.prorationMethod,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      showToast("success", "Configuración guardada");
      loadBranchData();
    } catch (e) {
      showToast("error", "Error al guardar configuración");
      console.error(e);
    }
  };

  const handleCalculate = async () => {
    if (!selectedBranchId || !calcCost) return;
    try {
      // IVA se aplica al COSTO DE COMPRA, no al precio de venta
      const costoBase = Number(calcCost);
      const iva = Number(ivaPercent) || 0;
      const costoReal = iva > 0 ? costoBase * (1 + iva / 100) : costoBase;

      const res = await fetch(
        `/api/pricing/suggested?branchId=${selectedBranchId}&purchaseCostPerUnit=${costoReal}`,
      );
      if (!res.ok) throw new Error("Failed");
      const data = unwrapApiData(await res.json());
      setCalcResult(data);
    } catch (e) {
      showToast("error", "Error al calcular precio");
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

      {/* ── Summary Cards ── */}
      {summary && selectedBranchId && (
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

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-[var(--color-surface-raised)] rounded-lg p-1 overflow-x-auto">
        {(["expenses", "pricing", "freight"] as const).map((tab) => {
          const labels = {
            expenses: { label: "Gastos Operativos", icon: DollarSign },
            pricing: { label: "Precios", icon: Calculator },
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

      {loading && (
        <div className="text-center py-8 text-[var(--color-text-muted)]">
          Cargando datos...
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* TAB: GASTOS OPERATIVOS */}
      {/* ══════════════════════════════════════════════════════════ */}
      {activeTab === "expenses" && selectedBranchId && !loading && (
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
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
              {newExpense.category === "PAYROLL" && (
                <div className="sm:col-span-4 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
                  La nómina se recomienda sincronizar desde Personal & Nómina para evitar doble conteo.
                </div>
              )}
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
                disabled={!newExpense.description || !newExpense.amount || newExpense.category === "PAYROLL"}
                icon={<Plus className="h-4 w-4" />}
              >
                Agregar
              </Button>
              <div className="sm:col-span-4 rounded-lg border border-[var(--color-info-200)] bg-[var(--color-info-50)] px-3 py-2 text-xs text-[var(--color-info-700)]">
                Los prestamos a empleados no son gasto operativo; se recuperan via deduccion de nomina.
              </div>
            </div>
          </Card>

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

          {/* ── Expense List by Category ── */}
          {summary && (
            <div className="space-y-3">
              {Object.entries(summary.byCategory)
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
      {/* TAB: PRECIOS (Configuración + Calculadora) */}
      {/* ══════════════════════════════════════════════════════════ */}
      {activeTab === "pricing" && selectedBranchId && !loading && (
        <div className="space-y-6">
          {/* ── Configuración de precios ── */}
          <Card className="p-6">
            <h4 className="text-sm font-semibold text-[var(--color-text)] mb-1 flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Configuración de Precios · {selectedBranch?.name}
            </h4>
            <p className="text-xs text-[var(--color-text-muted)] mb-5">
              Define el margen de utilidad deseado y las unidades mensuales estimadas para calcular precios sugeridos.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input
                label="Margen de Utilidad (%)"
                type="number"
                min="0.1"
                max="99.9"
                step="0.1"
                value={configForm.desiredMarginPercent}
                onChange={(e) => setConfigForm((p) => ({ ...p, desiredMarginPercent: e.target.value }))}
                hint="Ejemplo: 30 = 30% de ganancia sobre precio de venta"
              />
              <Input
                label="Unidades Mensuales Estimadas"
                type="number"
                min="1"
                step="1"
                value={configForm.estimatedMonthlyUnits}
                onChange={(e) => setConfigForm((p) => ({ ...p, estimatedMonthlyUnits: e.target.value }))}
                hint="Total de unidades vendidas al mes en la sucursal"
              />
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                  Método de Prorrateo
                </label>
                <select
                  className="w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-[var(--color-text)] focus:ring-2 focus:ring-[var(--color-info-500)] focus:border-[var(--color-info-500)] transition-colors min-h-[44px]"
                  value={configForm.prorationMethod}
                  onChange={(e) => setConfigForm((p) => ({ ...p, prorationMethod: e.target.value }))}
                >
                  <option value="BY_QUANTITY">Prorrateo por cantidad (MVP actual)</option>
                </select>
                <p className="text-xs text-[var(--color-text-soft)] mt-1">
                  BY_VALUE queda reservado para una fase posterior.
                </p>
              </div>
            </div>

            <Button variant="primary" className="mt-5" onClick={handleSaveConfig} icon={<Save className="h-4 w-4" />}>
              Guardar Configuración
            </Button>
          </Card>

          {/* ── Calculadora de precio sugerido ── */}
          <Card className="p-6">
            <h4 className="text-sm font-semibold text-[var(--color-text)] mb-1 flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Calculadora de Precio Sugerido
            </h4>
            <p className="text-xs text-[var(--color-text-muted)] mb-5">
              Ingresa el costo de compra por unidad para obtener el precio de venta sugerido.
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Input
                  label="Costo Base sin IVA (C$)"
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-48 text-lg"
                  placeholder="Ej: 400"
                  value={calcCost}
                  onChange={(e) => setCalcCost(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCalculate()}
                />
              </div>
              <div>
                <Input
                  label="IVA (%)"
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  className="w-28"
                  placeholder="15"
                  value={ivaPercent}
                  onChange={(e) => setIvaPercent(e.target.value)}
                  hint="0 = sin IVA"
                />
              </div>
              <Button
                variant="success"
                onClick={handleCalculate}
                disabled={!calcCost}
                icon={<Calculator className="h-4 w-4" />}
              >
                Calcular
              </Button>
            </div>
          </Card>

          {/* ── Resultado del cálculo ── */}
          {calcResult && (
            <Card variant="outlined" className="border-2 border-[var(--color-success-200)] bg-gradient-to-br from-[var(--color-success-50)] to-white p-6">
              <h4 className="text-sm font-semibold text-[var(--color-success-700)] mb-4 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Resultado del Cálculo
              </h4>

              {!calcResult.configExists && (
                <div className="mb-4 flex items-start gap-2 rounded-lg bg-[var(--color-warning-50)] border border-[var(--color-warning-100)] p-3">
                  <AlertTriangle className="h-4 w-4 text-[var(--color-warning-600)] mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-[var(--color-warning-700)]">
                    No hay configuración de precios para esta sucursal. Se usan valores por defecto
                    (Margen: 30%, Unidades: 1,000).
                  </p>
                </div>
              )}

              {/* Price breakdown — IVA aplicado al COSTO, no al precio */}
              {(() => {
                const iva = Number(ivaPercent) || 0;
                const costoBase = Number(calcCost) || 0;
                const ivaAmount = iva > 0 ? costoBase * (iva / 100) : 0;
                const costoConIva = costoBase + ivaAmount;
                // calcResult.purchaseCost ya incluye IVA (se envió costoReal al API)
                return (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <div className="flex justify-between items-center py-2 border-b border-[var(--color-success-100)]">
                          <span className="text-xs text-[var(--color-text-muted)]">Costo Base (sin IVA)</span>
                          <span className="text-sm font-semibold">{formatC(costoBase)}</span>
                        </div>
                        {iva > 0 && (
                          <div className="flex justify-between items-center py-2 border-b border-[var(--color-success-100)]">
                            <span className="text-xs text-[var(--color-text-muted)]">IVA ({iva}%) sobre costo</span>
                            <span className="text-sm font-semibold text-[var(--color-warning-600)]">
                              + {formatC(ivaAmount)}
                            </span>
                          </div>
                        )}
                        {iva > 0 && (
                          <div className="flex justify-between items-center py-2 border-b border-[var(--color-success-100)]">
                            <span className="text-xs text-[var(--color-text-muted)]">Costo Real (con IVA)</span>
                            <span className="text-sm font-bold">{formatC(costoConIva)}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center py-2 border-b border-[var(--color-success-100)]">
                          <span className="text-xs text-[var(--color-text-muted)]">Gasto Operativo / Unidad</span>
                          <span className="text-sm font-semibold text-[var(--color-danger-600)]">
                            + {formatC(calcResult.operatingExpensePerUnit)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-[var(--color-success-100)]">
                          <span className="text-xs text-[var(--color-text-muted)]">Costo Total / Unidad</span>
                          <span className="text-sm font-bold">{formatC(calcResult.totalCostPerUnit)}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-[var(--color-success-100)]">
                          <span className="text-xs text-[var(--color-text-muted)]">Margen Aplicado</span>
                          <span className="text-sm font-semibold text-[var(--color-info-600)]">
                            {calcResult.marginPercent}%
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-center justify-center bg-[var(--color-success-100)]/50 rounded-xl p-6">
                        <p className="text-xs text-[var(--color-success-700)] font-medium mb-1">PRECIO SUGERIDO DE VENTA</p>
                        <p className="text-3xl font-bold text-[var(--color-success-700)]">
                          {formatC(calcResult.suggestedPrice)}
                        </p>
                        <p className="text-xs text-[var(--color-success-600)] mt-2">
                          Ganancia: {formatC(calcResult.suggestedPrice - calcResult.totalCostPerUnit)} por unidad
                        </p>
                        {iva > 0 && (
                          <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                            IVA ya incluido en el costo de compra
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-[var(--color-success-100)] grid grid-cols-2 gap-4 text-xs text-[var(--color-text-muted)]">
                      <p>
                        <strong>Gastos mensuales totales:</strong> {formatC(calcResult.totalMonthlyExpenses)}
                      </p>
                      <p>
                        <strong>Unidades estimadas/mes:</strong>{" "}
                        {calcResult.estimatedMonthlyUnits.toLocaleString()}
                      </p>
                    </div>
                  </>
                );
              })()}
            </Card>
          )}

          {/* Formula explanation */}
          <Card variant="outlined" className="border-[var(--color-info-200)] bg-[var(--color-info-50)] p-5">
            <h5 className="text-sm font-semibold text-[var(--color-info-700)] mb-3 flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Fórmula de Cálculo
            </h5>
            <div className="space-y-2 text-xs text-[var(--color-info-700)]">
              <div className="font-mono bg-[var(--color-surface)]/60 rounded-lg p-3 space-y-1">
                <p><strong>1.</strong> Costo Real = Costo Base × (1 + IVA/100) &nbsp;← IVA sobre el costo</p>
                <p><strong>2.</strong> Gasto por Unidad = Gastos Mensuales Totales ÷ Unidades Estimadas</p>
                <p><strong>3.</strong> Costo Total = Costo Real + Gasto por Unidad</p>
                <p><strong>4.</strong> Precio Sugerido = Costo Total ÷ (1 − Margen/100)</p>
              </div>
              <div className="mt-3 bg-[var(--color-surface)]/60 rounded-lg p-3">
                <p className="font-semibold mb-1">Ejemplo:</p>
                <p>Costo base del cemento = C$400 · IVA = 15%</p>
                <p>Costo real = C$400 × 1.15 = <strong>C$460.00</strong></p>
                <p>Gastos mensuales = C$50,000 · Unidades estimadas = 1,000</p>
                <p>Gasto por unidad = C$50,000 ÷ 1,000 = <strong>C$50.00</strong></p>
                <p>Costo total = C$460 + C$50 = <strong>C$510.00</strong></p>
                <p>Margen deseado = 7%</p>
                <p>Precio sugerido = C$510 ÷ (1 − 0.07) = <strong>C$548.39</strong></p>
              </div>
            </div>
          </Card>
        </div>
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
