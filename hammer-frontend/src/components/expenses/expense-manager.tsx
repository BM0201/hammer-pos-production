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
  Percent,
  Package,
  Receipt,
  ArrowRight,
  Sparkles,
  Info,
  BadgeDollarSign,
  ShieldCheck,
  Zap,
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
      {/* TAB: PRECIOS (Configuración + Calculadora) — Rediseño */}
      {/* ══════════════════════════════════════════════════════════ */}
      {activeTab === "pricing" && selectedBranchId && !loading && (
        <div className="space-y-8">

          {/* ── Header de sección ── */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md shadow-indigo-500/25">
              <BadgeDollarSign className="h-5 w-5 text-white" />
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
                    Unidades Mensuales Estimadas
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
                    Total de productos distintos vendidos al mes en esta sucursal
                  </p>
                </div>

                {/* Método de prorrateo */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                    <PieChart className="h-3.5 w-3.5 text-[var(--color-info-600)]" />
                    Método de Prorrateo
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-100 border border-blue-300 px-3 py-2 text-xs font-bold text-blue-800">
                      <Zap className="h-3 w-3" />
                      Por cantidad (MVP)
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    Gastos se dividen equitativamente entre unidades vendidas
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
                      onChange={(e) => setCalcCost(e.target.value)}
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
                </div>

                {/* Live preview del costo real */}
                {calcCost && (
                  <div className="rounded-xl bg-emerald-50 border-2 border-emerald-200 p-4 space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Vista previa</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-700">Costo base</span>
                      <span className="text-sm font-bold text-slate-900">{formatC(Number(calcCost) || 0)}</span>
                    </div>
                    {Number(ivaPercent) > 0 && (
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
                        {formatC((Number(calcCost) || 0) * (1 + (Number(ivaPercent) || 0) / 100))}
                      </span>
                    </div>
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
            const iva = Number(ivaPercent) || 0;
            const costoBase = Number(calcCost) || 0;
            const ivaAmount = iva > 0 ? costoBase * (iva / 100) : 0;
            const costoConIva = costoBase + ivaAmount;
            const ganancia = calcResult.suggestedPrice - calcResult.totalCostPerUnit;
            const gananciaPercent = calcResult.totalCostPerUnit > 0
              ? ((ganancia / calcResult.totalCostPerUnit) * 100).toFixed(1)
              : "0.0";

            return (
              <div className="relative overflow-hidden rounded-2xl border-2 border-emerald-300 dark:border-emerald-800 bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-emerald-950/30 dark:via-[var(--color-surface)] dark:to-teal-950/20 shadow-xl shadow-emerald-500/10">
                {/* Accent bar */}
                <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500" />

                {!calcResult.configExists && (
                  <div className="mx-6 mt-5 flex items-start gap-2 rounded-xl bg-[var(--color-warning-50)] dark:bg-amber-900/20 border border-[var(--color-warning-200)] dark:border-amber-800 p-3">
                    <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-[var(--color-warning-700)] dark:text-amber-300">
                      No hay configuración guardada para esta sucursal. Se usan valores por defecto (Margen: 30%, Unidades: 1,000).
                    </p>
                  </div>
                )}

                <div className="p-6 lg:p-8">
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
                      {iva > 0 && (
                        <div className="flex items-center gap-3 rounded-xl bg-[var(--color-warning-50)]/80 dark:bg-amber-900/10 px-4 py-3">
                          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-200 dark:bg-amber-800 text-[10px] font-bold text-[var(--color-warning-700)] dark:text-amber-300">2</div>
                          <span className="flex-1 text-sm text-[var(--color-warning-700)] dark:text-amber-400">+ IVA ({iva}%)</span>
                          <span className="text-sm font-semibold tabular-nums text-[var(--color-warning-700)] dark:text-amber-400">+ {formatC(ivaAmount)}</span>
                        </div>
                      )}

                      {/* Step 3: Costo Real */}
                      {iva > 0 && (
                        <div className="flex items-center gap-3 rounded-xl bg-slate-100/80 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 px-4 py-3">
                          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-300 dark:bg-slate-600 text-[10px] font-bold text-slate-700 dark:text-slate-200">=</div>
                          <span className="flex-1 text-sm font-semibold text-[var(--color-text)]">Costo Real</span>
                          <span className="text-sm font-bold tabular-nums">{formatC(costoConIva)}</span>
                        </div>
                      )}

                      {/* Step 4: Gasto operativo */}
                      <div className="flex items-center gap-3 rounded-xl bg-rose-50/60 dark:bg-rose-900/10 px-4 py-3">
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-rose-200 dark:bg-rose-800 text-[10px] font-bold text-rose-700 dark:text-rose-300">{iva > 0 ? "3" : "2"}</div>
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
                        <span className="flex-1 text-sm font-semibold text-[var(--color-text)]">Costo Total / Unidad</span>
                        <span className="text-sm font-bold tabular-nums">{formatC(calcResult.totalCostPerUnit)}</span>
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
                          <p className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Margen</p>
                          <p className="text-lg font-bold text-[var(--color-master-600)] dark:text-[var(--color-master-400)]">{calcResult.marginPercent}%</p>
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

                      {iva > 0 && (
                        <p className="mt-4 text-[10px] text-[var(--color-text-muted)] flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          IVA ({iva}%) incluido en el costo de compra
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── Fórmula de cálculo — Rediseño colapsable ── */}
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
