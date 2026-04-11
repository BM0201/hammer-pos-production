"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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

/* ══════════════════════════════════════════════════════════════ */

export function ExpenseManager() {
  /* ── State ── */
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [pricingConfig, setPricingConfig] = useState<PricingConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"expenses" | "config" | "calculator">("expenses");

  /* Form state */
  const [newExpense, setNewExpense] = useState({
    category: "PAYROLL",
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

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  /* ── Load branches ── */
  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((data) => {
        setBranches(data);
        if (data.length > 0 && !selectedBranchId) {
          setSelectedBranchId(data[0].id);
        }
      })
      .catch(console.error);
  }, []);

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
      const expData = await expRes.json();
      const sumData = await sumRes.json();
      const cfgData = await cfgRes.json();

      setExpenses(expData);
      setSummary(sumData);
      setPricingConfig(cfgData);

      if (cfgData && cfgData.id) {
        setConfigForm({
          desiredMarginPercent: String(cfgData.desiredMarginPercent),
          estimatedMonthlyUnits: String(cfgData.estimatedMonthlyUnits),
          prorationMethod: cfgData.prorationMethod || "BY_QUANTITY",
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

  /* ── Handlers ── */

  const handleCreateExpense = async () => {
    if (!newExpense.description || !newExpense.amount || !selectedBranchId) return;
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: selectedBranchId,
          category: newExpense.category,
          description: newExpense.description,
          amount: parseFloat(newExpense.amount),
        }),
      });
      if (!res.ok) throw new Error("Failed to create expense");
      setNewExpense({ category: "PAYROLL", description: "", amount: "" });
      showToast("success", "Gasto registrado correctamente");
      loadBranchData();
    } catch (e) {
      showToast("error", "Error al registrar gasto");
      console.error(e);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (!confirm("¿Desactivar este gasto?")) return;
    try {
      await fetch(`/api/expenses/${id}`, { method: "DELETE" });
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
      const res = await fetch("/api/pricing/config", {
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
      const res = await fetch(
        `/api/pricing/suggested?branchId=${selectedBranchId}&purchaseCostPerUnit=${calcCost}`,
      );
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setCalcResult(data);
    } catch (e) {
      showToast("error", "Error al calcular precio");
      console.error(e);
    }
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
      <div className="flex gap-1 bg-[var(--color-surface-raised)] rounded-lg p-1">
        {(["expenses", "config", "calculator"] as const).map((tab) => {
          const labels = {
            expenses: { label: "Gastos Operativos", icon: DollarSign },
            config: { label: "Configuración de Precios", icon: Settings },
            calculator: { label: "Calculadora de Precio", icon: Calculator },
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
              <span className="hidden sm:inline">{label}</span>
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
      {/* TAB: CONFIGURACIÓN DE PRECIOS */}
      {/* ══════════════════════════════════════════════════════════ */}
      {activeTab === "config" && selectedBranchId && !loading && (
        <div className="space-y-6">
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
                  <option value="BY_QUANTITY">Por Cantidad (unidades)</option>
                  <option value="BY_VALUE">Por Valor (C$)</option>
                </select>
                <p className="text-xs text-[var(--color-text-soft)] mt-1">
                  Cómo se distribuyen los gastos entre productos
                </p>
              </div>
            </div>

            <Button variant="primary" className="mt-5" onClick={handleSaveConfig} icon={<Save className="h-4 w-4" />}>
              Guardar Configuración
            </Button>
          </Card>

          {/* Formula explanation */}
          <Card variant="outlined" className="border-[var(--color-info-200)] bg-[var(--color-info-50)] p-5">
            <h5 className="text-sm font-semibold text-[var(--color-info-700)] mb-3 flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Fórmula de Cálculo
            </h5>
            <div className="space-y-2 text-xs text-[var(--color-info-700)]">
              <div className="font-mono bg-[var(--color-surface)]/60 rounded-lg p-3 space-y-1">
                <p><strong>1.</strong> Gasto por Unidad = Gastos Mensuales Totales ÷ Unidades Estimadas</p>
                <p><strong>2.</strong> Costo Total = Costo de Compra + Gasto por Unidad</p>
                <p><strong>3.</strong> Precio Sugerido = Costo Total ÷ (1 − Margen/100)</p>
              </div>
              <div className="mt-3 bg-[var(--color-surface)]/60 rounded-lg p-3">
                <p className="font-semibold mb-1">Ejemplo:</p>
                <p>Gastos mensuales = C$50,000 · Unidades estimadas = 1,000</p>
                <p>Gasto por unidad = C$50,000 ÷ 1,000 = <strong>C$50.00</strong></p>
                <p>Costo de compra del cemento = C$400</p>
                <p>Costo total = C$400 + C$50 = <strong>C$450.00</strong></p>
                <p>Margen deseado = 7%</p>
                <p>Precio sugerido = C$450 ÷ (1 − 0.07) = <strong>C$483.87</strong></p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* TAB: CALCULADORA DE PRECIO SUGERIDO */}
      {/* ══════════════════════════════════════════════════════════ */}
      {activeTab === "calculator" && selectedBranchId && !loading && (
        <div className="space-y-6">
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
                  label="Costo de Compra (C$)"
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

          {/* ── Result ── */}
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

              {/* Price breakdown */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b border-[var(--color-success-100)]">
                    <span className="text-xs text-[var(--color-text-muted)]">Costo de Compra</span>
                    <span className="text-sm font-semibold">{formatC(calcResult.purchaseCost)}</span>
                  </div>
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
                  <p className="text-xs text-[var(--color-success-700)] font-medium mb-1">PRECIO SUGERIDO</p>
                  <p className="text-3xl font-bold text-[var(--color-success-700)]">
                    {formatC(calcResult.suggestedPrice)}
                  </p>
                  <p className="text-xs text-[var(--color-success-600)] mt-2">
                    Ganancia: {formatC(calcResult.suggestedPrice - calcResult.totalCostPerUnit)} por unidad
                  </p>
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
            </Card>
          )}
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
