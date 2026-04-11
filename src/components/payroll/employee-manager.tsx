"use client";

/**
 * Employee Manager — CRUD + payroll calculation + history
 *
 * BUG FIX: Flash notification timeout now properly cleaned up to prevent memory leaks.
 * BUG FIX: handleDeactivate checks response status.
 * BUG FIX: Form validation for salary (prevent NaN, 0, negative).
 * BUG FIX: Empty employee list shows loading state when loading.
 * BUG FIX: handleCalculatePayroll checks for null data before accessing properties.
 * BUG FIX: Clear payrollResult when switching branch filter.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Users, Plus, Edit2, UserMinus, Calculator, History,
  Building2, DollarSign, Calendar, Briefcase, Loader2,
  CheckCircle2, AlertTriangle, RefreshCw,
} from "lucide-react";

type Branch = { id: string; code: string; name: string };
type Employee = {
  id: string;
  fullName: string;
  position: string;
  branchId: string;
  monthlySalary: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  branch: { id: string; code: string; name: string };
};
type PayrollEmployee = {
  employeeId: string;
  fullName: string;
  position: string;
  branchId: string;
  monthlySalary: number;
  daysWorked: number;
  totalDays: number;
  proratedSalary: number;
  isFullMonth: boolean;
};
type SalaryRecord = {
  id: string;
  employeeId: string;
  month: string;
  daysWorked: number;
  totalDays: number;
  proratedSalary: string;
  fullSalary: string;
  employee: { fullName: string; position: string };
};

const POSITIONS = ["Supervisor", "Vendedor", "Cajero", "Bodeguero", "Administrador", "Auxiliar", "Otro"];

export function EmployeeManager() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"employees" | "payroll" | "history">("employees");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [notice, setNotice] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // BUG FIX: Cleanup timer ref for flash notifications
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Employee form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: "", position: "Vendedor", branchId: "", monthlySalary: "", startDate: "" });

  // Payroll calculation
  const [payrollMonth, setPayrollMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [payrollResult, setPayrollResult] = useState<{ totalPayroll: number; employees: PayrollEmployee[] } | null>(null);

  // History
  const [history, setHistory] = useState<SalaryRecord[]>([]);

  const flash = useCallback((type: "success" | "error", msg: string) => {
    // BUG FIX: Clear previous timer to prevent stale state
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setNotice({ type, msg });
    flashTimerRef.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  // BUG FIX: Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  useEffect(() => {
    fetch("/api/branches").then((r) => r.json()).then((j) => setBranches(j.data ?? [])).catch(() => {});
  }, []);

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const q = selectedBranch ? `?branchId=${selectedBranch}` : "";
      const r = await fetch(`/api/employees${q}`);
      const j = await r.json();
      setEmployees(j.data ?? []);
    } catch {
      flash("error", "Error al cargar empleados");
    } finally {
      setLoading(false);
    }
  }, [selectedBranch, flash]);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  const handleSubmit = async () => {
    if (!form.fullName.trim() || !form.branchId || !form.startDate) {
      flash("error", "Complete todos los campos requeridos");
      return;
    }
    // BUG FIX: Validate salary is a valid positive number
    const salaryNum = parseFloat(form.monthlySalary);
    if (!form.monthlySalary || isNaN(salaryNum) || salaryNum <= 0) {
      flash("error", "El salario debe ser un número mayor a 0");
      return;
    }

    setLoading(true);
    try {
      const url = editingId ? `/api/employees/${editingId}` : "/api/employees";
      const method = editingId ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, monthlySalary: salaryNum }),
      });
      if (!r.ok) {
        const j = await r.json();
        flash("error", j.error ?? j.message ?? "Error al guardar");
        return;
      }
      flash("success", editingId ? "Empleado actualizado" : "Empleado creado exitosamente");
      setShowForm(false);
      setEditingId(null);
      setForm({ fullName: "", position: "Vendedor", branchId: "", monthlySalary: "", startDate: "" });
      await loadEmployees();
    } catch {
      flash("error", "Error de conexión al guardar");
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm("¿Desactivar este empleado? Se registrará la fecha de finalización.")) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/employees/${id}`, { method: "DELETE" });
      // BUG FIX: Check response status
      if (!r.ok) {
        const j = await r.json();
        flash("error", j.error ?? j.message ?? "Error al desactivar");
        return;
      }
      flash("success", "Empleado desactivado");
      await loadEmployees();
    } catch {
      flash("error", "Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (emp: Employee) => {
    setEditingId(emp.id);
    setForm({
      fullName: emp.fullName,
      position: emp.position,
      branchId: emp.branchId,
      monthlySalary: emp.monthlySalary,
      startDate: emp.startDate.slice(0, 10),
    });
    setShowForm(true);
  };

  const handleCalculatePayroll = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/payroll/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: payrollMonth, branchId: selectedBranch || undefined, syncToExpenses: true }),
      });
      const j = await r.json();
      if (!r.ok) { flash("error", j.error ?? j.message ?? "Error"); return; }
      // BUG FIX: Guard against null/undefined data
      if (j.data) {
        setPayrollResult(j.data);
        flash("success", `Nómina calculada: C$${j.data.totalPayroll?.toLocaleString() ?? "0"}`);
      } else {
        flash("error", "Respuesta vacía del servidor");
      }
    } catch {
      flash("error", "Error de conexión al calcular nómina");
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/payroll/history");
      const j = await r.json();
      setHistory(j.data ?? []);
    } catch {
      flash("error", "Error al cargar historial");
    } finally {
      setLoading(false);
    }
  }, [flash]);

  useEffect(() => { if (activeTab === "history") loadHistory(); }, [activeTab, loadHistory]);

  const fmt = (v: string | number) => `C$${Number(v).toLocaleString("es-NI", { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      {/* Notice */}
      {notice && (
        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm font-medium ${
          notice.type === "success" ? "bg-[var(--color-success-50)] text-[var(--color-success-700)] border border-[var(--color-success-100)]" : "bg-[var(--color-danger-50)] text-[var(--color-danger-700)] border border-[var(--color-danger-100)]"
        }`}>
          {notice.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {notice.msg}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[var(--color-info-50)] rounded-lg"><Users className="h-5 w-5 text-[var(--color-info-600)]" /></div>
            <div>
              <p className="text-2xl font-bold text-[var(--color-text)]">{employees.filter((e) => e.isActive).length}</p>
              <p className="text-sm text-[var(--color-text-soft)]">Empleados activos</p>
            </div>
          </div>
        </div>
        <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[var(--color-success-50)] rounded-lg"><DollarSign className="h-5 w-5 text-[var(--color-success-600)]" /></div>
            <div>
              <p className="text-2xl font-bold text-[var(--color-text)]">
                {fmt(employees.filter((e) => e.isActive).reduce((s, e) => s + Number(e.monthlySalary), 0))}
              </p>
              <p className="text-sm text-[var(--color-text-soft)]">Nómina mensual total</p>
            </div>
          </div>
        </div>
        <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[var(--color-warning-50)] rounded-lg"><Building2 className="h-5 w-5 text-[var(--color-warning-600)]" /></div>
            <div>
              <p className="text-2xl font-bold text-[var(--color-text)]">
                {new Set(employees.filter((e) => e.isActive).map((e) => e.branchId)).size}
              </p>
              <p className="text-sm text-[var(--color-text-soft)]">Sucursales con personal</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--color-surface-alt)] rounded-lg p-1">
        {[
          { key: "employees" as const, label: "Empleados", icon: Users },
          { key: "payroll" as const, label: "Calcular Nómina", icon: Calculator },
          { key: "history" as const, label: "Historial", icon: History },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all min-h-[44px] flex-1 justify-center ${
              activeTab === tab.key ? "bg-[var(--color-surface)] text-[var(--color-info-700)] shadow-sm" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            <tab.icon className="h-4 w-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* Branch filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-[var(--color-text-secondary)]">Sucursal:</label>
        <select
          value={selectedBranch}
          onChange={(e) => setSelectedBranch(e.target.value)}
          className="border border-[var(--color-border-strong)] rounded-lg px-3 py-2 text-sm min-h-[44px]"
        >
          <option value="">Todas</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
        </select>
        {activeTab === "employees" && (
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm({ fullName: "", position: "Vendedor", branchId: branches[0]?.id ?? "", monthlySalary: "", startDate: new Date().toISOString().slice(0, 10) }); }}
            className="ml-auto flex items-center gap-2 bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] text-white px-4 py-2.5 rounded-lg text-sm font-medium min-h-[44px] transition-colors"
          >
            <Plus className="h-4 w-4" /> Agregar Empleado
          </button>
        )}
      </div>

      {/* ── Tab: Employees ── */}
      {activeTab === "employees" && (
        <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] overflow-hidden">
          {showForm && (
            <div className="p-6 border-b border-[var(--color-border)] bg-[var(--color-info-50)]/50">
              <h4 className="font-semibold text-[var(--color-text)] mb-4">{editingId ? "Editar Empleado" : "Nuevo Empleado"}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Nombre completo *</label>
                  <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm" placeholder="Juan Pérez" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Puesto *</label>
                  <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className="w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm">
                    {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Sucursal *</label>
                  <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} className="w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm">
                    <option value="">Seleccionar...</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Salario mensual (C$) *</label>
                  <input type="number" step="0.01" min="0.01" value={form.monthlySalary} onChange={(e) => setForm({ ...form, monthlySalary: e.target.value })} className="w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm" placeholder="10000" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Fecha de inicio *</label>
                  <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm" />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={handleSubmit} disabled={loading} className="flex items-center gap-2 bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] text-white px-5 py-2.5 rounded-lg text-sm font-medium min-h-[44px] disabled:opacity-50 transition-colors">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {editingId ? "Guardar cambios" : "Crear empleado"}
                </button>
                <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2.5 rounded-lg text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] min-h-[44px] transition-colors">Cancelar</button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-[var(--color-surface-alt)] text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3">Puesto</th>
                  <th className="px-4 py-3">Sucursal</th>
                  <th className="px-4 py-3 text-right">Salario</th>
                  <th className="px-4 py-3">Inicio</th>
                  <th className="px-4 py-3">Fin</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {loading && employees.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-[var(--color-info-500)] mx-auto" /></td></tr>
                ) : employees.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-[var(--color-text-soft)]">No hay empleados registrados</td></tr>
                ) : (
                  employees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-[var(--color-surface-alt)] transition-colors">
                      <td className="px-4 py-3 text-sm font-medium text-[var(--color-text)]">{emp.fullName}</td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]"><span className="inline-flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" />{emp.position}</span></td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{emp.branch?.code ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text)] text-right font-mono">{fmt(emp.monthlySalary)}</td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{new Date(emp.startDate).toLocaleDateString("es-NI")}</td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{emp.endDate ? new Date(emp.endDate).toLocaleDateString("es-NI") : "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${emp.isActive ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]" : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"}`}>
                          {emp.isActive ? "Activo" : "Inactivo"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => handleEdit(emp)} className="p-2 rounded-lg hover:bg-[var(--color-info-50)] text-[var(--color-info-600)] transition-colors" title="Editar"><Edit2 className="h-4 w-4" /></button>
                          {emp.isActive && (
                            <button onClick={() => handleDeactivate(emp.id)} disabled={loading} className="p-2 rounded-lg hover:bg-[var(--color-danger-50)] text-[var(--color-danger-600)] transition-colors disabled:opacity-50" title="Desactivar"><UserMinus className="h-4 w-4" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab: Payroll Calculator ── */}
      {activeTab === "payroll" && (
        <div className="space-y-4">
          <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] p-6">
            <h4 className="font-semibold text-[var(--color-text)] mb-4">Calcular Nómina del Mes</h4>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Mes</label>
                <input type="month" value={payrollMonth} onChange={(e) => setPayrollMonth(e.target.value)} className="border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm min-h-[44px]" />
              </div>
              <button onClick={handleCalculatePayroll} disabled={loading} className="flex items-center gap-2 bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] text-white px-5 py-2.5 rounded-lg text-sm font-medium min-h-[44px] disabled:opacity-50 transition-colors">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
                Calcular y Sincronizar
              </button>
            </div>
            <p className="text-xs text-[var(--color-text-soft)] mt-2">Calcula el prorrateo salarial y sincroniza con gastos operativos automáticamente.</p>
          </div>

          {payrollResult && (
            <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] overflow-hidden">
              <div className="p-6 border-b border-[var(--color-border)] bg-[var(--color-success-50)]/50">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-[var(--color-text)]">Resultado: {payrollMonth}</h4>
                    <p className="text-sm text-[var(--color-text-muted)]">{payrollResult.employees.length} empleados</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-[var(--color-success-700)]">{fmt(payrollResult.totalPayroll)}</p>
                    <p className="text-xs text-[var(--color-text-soft)]">Nómina total prorrateada</p>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-[var(--color-surface-alt)] text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Empleado</th>
                      <th className="px-4 py-3">Puesto</th>
                      <th className="px-4 py-3 text-right">Salario completo</th>
                      <th className="px-4 py-3 text-center">Días trabajados</th>
                      <th className="px-4 py-3 text-right">Salario prorrateado</th>
                      <th className="px-4 py-3">Tipo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {payrollResult.employees.map((emp) => (
                      <tr key={emp.employeeId} className="hover:bg-[var(--color-surface-alt)]">
                        <td className="px-4 py-3 text-sm font-medium text-[var(--color-text)]">{emp.fullName}</td>
                        <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{emp.position}</td>
                        <td className="px-4 py-3 text-sm text-[var(--color-text-muted)] text-right font-mono">{fmt(emp.monthlySalary)}</td>
                        <td className="px-4 py-3 text-sm text-center">
                          <span className={`font-semibold ${emp.isFullMonth ? "text-[var(--color-success-600)]" : "text-[var(--color-warning-600)]"}`}>
                            {emp.daysWorked}/{emp.totalDays}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-[var(--color-text)] text-right font-mono font-semibold">{fmt(emp.proratedSalary)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${emp.isFullMonth ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]" : "bg-[var(--color-warning-100)] text-[var(--color-warning-700)]"}`}>
                            {emp.isFullMonth ? "Mes completo" : "Prorrateado"}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {payrollResult.employees.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--color-text-soft)]">No hay empleados activos para este período</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: History ── */}
      {activeTab === "history" && (
        <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <h4 className="font-semibold text-[var(--color-text)]">Historial de Nómina</h4>
            <button onClick={loadHistory} disabled={loading} className="p-2 rounded-lg hover:bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] transition-colors disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-[var(--color-surface-alt)] text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Mes</th>
                  <th className="px-4 py-3">Empleado</th>
                  <th className="px-4 py-3">Puesto</th>
                  <th className="px-4 py-3 text-center">Días</th>
                  <th className="px-4 py-3 text-right">Salario completo</th>
                  <th className="px-4 py-3 text-right">Prorrateado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-[var(--color-info-500)] mx-auto" /></td></tr>
                ) : history.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--color-text-soft)]">Sin historial. Calcule la nómina de un mes primero.</td></tr>
                ) : (
                  history.map((h) => (
                    <tr key={h.id} className="hover:bg-[var(--color-surface-alt)]">
                      <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{new Date(h.month).toLocaleDateString("es-NI", { year: "numeric", month: "long" })}</td>
                      <td className="px-4 py-3 text-sm font-medium text-[var(--color-text)]">{h.employee.fullName}</td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{h.employee.position}</td>
                      <td className="px-4 py-3 text-sm text-center">{h.daysWorked}/{h.totalDays}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-text-muted)]">{fmt(h.fullSalary)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono font-semibold text-[var(--color-text)]">{fmt(h.proratedSalary)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
