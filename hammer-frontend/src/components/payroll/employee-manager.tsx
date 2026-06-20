"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users,
  Plus,
  Edit2,
  UserMinus,
  Calculator,
  History,
  Building2,
  DollarSign,
  Briefcase,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import toast from "react-hot-toast";

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
  grossSalary: number;
  loanDeductions: number;
  otherDeductions: number;
  netPay: number;
  employerCost: number;
};
type PayrollResult = {
  payrollRunId: string;
  payrollRunStatus: "DRAFT" | "POSTED" | string;
  year?: number;
  month?: number;
  totalPayroll: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalEmployerCost: number;
  employees: PayrollEmployee[];
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
type PayrollRunSummary = PayrollResult & { employeeCount: number; year: number; month: number };
type EmployeeLoan = {
  id: string;
  employeeId: string;
  branchId: string;
  principalAmount: string;
  outstandingBalance: string;
  installmentAmount: string | null;
  issuedAt: string;
  status: "ACTIVE" | "PAID" | "CANCELLED" | string;
  notes: string | null;
  employee: { id: string; fullName: string; position: string };
  branch: { id: string; code: string; name: string };
};
type ActiveTab = "employees" | "payroll" | "loans" | "history";

const POSITIONS = ["Supervisor", "Vendedor", "Cajero", "Bodeguero", "Administrador", "Auxiliar", "Otro"];
const LOAN_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Activo",
  PAID: "Pagado",
  CANCELLED: "Cancelado",
};

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const data = payload as { error?: { message?: string } | string; message?: string };
    if (typeof data.error === "string") return data.error;
    if (data.error?.message) return data.error.message;
    if (data.message) return data.message;
  }
  return fallback;
}

export function EmployeeManager() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("employees");
  const [selectedBranch, setSelectedBranch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: "", position: "Vendedor", branchId: "", monthlySalary: "", startDate: "" });

  const [payrollMonth, setPayrollMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [payrollResult, setPayrollResult] = useState<PayrollResult | null>(null);
  const [history, setHistory] = useState<SalaryRecord[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRunSummary[]>([]);

  const [loans, setLoans] = useState<EmployeeLoan[]>([]);
  const [loanForm, setLoanForm] = useState({
    employeeId: "",
    branchId: "",
    principalAmount: "",
    installmentAmount: "",
    notes: "",
  });

  // Inline confirmations & payment (replaces window.prompt / confirm)
  const [confirmDeactivateEmpId, setConfirmDeactivateEmpId] = useState<string | null>(null);
  const [confirmCancelLoanId, setConfirmCancelLoanId] = useState<string | null>(null);
  const [confirmPostPayroll, setConfirmPostPayroll] = useState(false);
  const [manualPaymentLoanId, setManualPaymentLoanId] = useState<string | null>(null);
  const [manualPaymentAmountStr, setManualPaymentAmountStr] = useState("");

  const flash = useCallback((type: "success" | "error", msg: string) => {
    if (type === "success") toast.success(msg);
    else toast.error(msg);
  }, []);

  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((j) => {
        const data = unwrapApiData(j);
        setBranches(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
  }, []);

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const q = selectedBranch ? `?branchId=${selectedBranch}` : "";
      const r = await fetch(`/api/employees${q}`);
      const j = unwrapApiData(await r.json());
      setEmployees(Array.isArray(j) ? j : []);
    } catch {
      flash("error", "Error al cargar empleados");
    } finally {
      setLoading(false);
    }
  }, [selectedBranch, flash]);

  const loadLoans = useCallback(async () => {
    setLoading(true);
    try {
      const q = selectedBranch ? `?branchId=${selectedBranch}` : "";
      const r = await fetch(`/api/payroll/loans${q}`);
      const j = unwrapApiData(await r.json());
      setLoans(Array.isArray(j) ? j : []);
    } catch {
      flash("error", "Error al cargar prestamos");
    } finally {
      setLoading(false);
    }
  }, [selectedBranch, flash]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const runsQuery = selectedBranch ? `?runs=true&branchId=${selectedBranch}` : "?runs=true";
      const [historyRes, runsRes] = await Promise.all([
        fetch("/api/payroll/history"),
        fetch(`/api/payroll/history${runsQuery}`),
      ]);
      const historyData = unwrapApiData(await historyRes.json());
      const runsData = unwrapApiData(await runsRes.json());
      setHistory(Array.isArray(historyData) ? historyData : []);
      setPayrollRuns(Array.isArray(runsData) ? runsData : []);
    } catch {
      flash("error", "Error al cargar historial");
    } finally {
      setLoading(false);
    }
  }, [selectedBranch, flash]);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);
  useEffect(() => { if (activeTab === "loans") loadLoans(); }, [activeTab, loadLoans]);
  useEffect(() => { if (activeTab === "history") loadHistory(); }, [activeTab, loadHistory]);
  useEffect(() => { setPayrollResult(null); }, [selectedBranch]);

  const fmt = (v: string | number | null | undefined) => `C$${Number(v ?? 0).toLocaleString("es-NI", { minimumFractionDigits: 2 })}`;

  const handleSubmit = async () => {
    if (!form.fullName.trim() || !form.branchId || !form.startDate) {
      flash("error", "Complete todos los campos requeridos");
      return;
    }
    const salaryNum = parseFloat(form.monthlySalary);
    if (!form.monthlySalary || Number.isNaN(salaryNum) || salaryNum <= 0) {
      flash("error", "El salario debe ser un numero mayor a 0");
      return;
    }

    setLoading(true);
    try {
      const url = editingId ? `/api/employees/${editingId}` : "/api/employees";
      const method = editingId ? "PUT" : "POST";
      const r = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, monthlySalary: salaryNum }),
      });
      const raw = await r.json();
      if (!r.ok) {
        flash("error", getErrorMessage(raw, "Error al guardar"));
        return;
      }
      flash("success", editingId ? "Empleado actualizado" : "Empleado creado exitosamente");
      setShowForm(false);
      setEditingId(null);
      setForm({ fullName: "", position: "Vendedor", branchId: "", monthlySalary: "", startDate: "" });
      await loadEmployees();
    } catch {
      flash("error", "Error de conexion al guardar");
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/employees/${id}`, { method: "DELETE" });
      if (!r.ok) {
        flash("error", getErrorMessage(await r.json(), "Error al desactivar"));
        return;
      }
      flash("success", "Empleado desactivado");
      await loadEmployees();
    } catch {
      flash("error", "Error de conexion");
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
      const r = await apiFetch("/api/payroll/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: payrollMonth, branchId: selectedBranch || undefined, syncToExpenses: false }),
      });
      const raw = await r.json();
      if (!r.ok) {
        flash("error", getErrorMessage(raw, "Error al calcular nomina"));
        return;
      }
      const data = unwrapApiData(raw) as PayrollResult;
      setPayrollResult(data);
      flash("success", `Nomina calculada: ${fmt(data.totalGross)}`);
    } catch {
      flash("error", "Error de conexion al calcular nomina");
    } finally {
      setLoading(false);
    }
  };

  const handlePostPayroll = async () => {
    if (!payrollResult?.payrollRunId) return;
    setLoading(true);
    try {
      const r = await apiFetch(`/api/payroll/runs/${payrollResult.payrollRunId}/post`, { method: "POST" });
      const raw = await r.json();
      if (!r.ok) {
        flash("error", getErrorMessage(raw, "Error al postear nomina"));
        return;
      }
      const data = unwrapApiData(raw) as PayrollResult & { alreadyPosted?: boolean };
      setPayrollResult(data);
      flash("success", data.alreadyPosted ? "La nomina ya estaba posteada" : "Nomina posteada");
      await loadLoans();
    } catch {
      flash("error", "Error de conexion al postear nomina");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateLoan = async () => {
    const principalAmount = Number(loanForm.principalAmount);
    const installmentAmount = loanForm.installmentAmount ? Number(loanForm.installmentAmount) : null;
    if (!loanForm.employeeId || !loanForm.branchId || !Number.isFinite(principalAmount) || principalAmount <= 0) {
      flash("error", "Seleccione empleado, sucursal y monto mayor a 0");
      return;
    }

    setLoading(true);
    try {
      const r = await apiFetch("/api/payroll/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: loanForm.employeeId,
          branchId: loanForm.branchId,
          principalAmount,
          installmentAmount,
          notes: loanForm.notes || null,
        }),
      });
      const raw = await r.json();
      if (!r.ok) {
        flash("error", getErrorMessage(raw, "Error al crear prestamo"));
        return;
      }
      setLoanForm({ employeeId: "", branchId: selectedBranch || "", principalAmount: "", installmentAmount: "", notes: "" });
      flash("success", "Prestamo/adelanto registrado");
      await loadLoans();
    } catch {
      flash("error", "Error de conexion al crear prestamo");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelLoan = async (id: string) => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/payroll/loans/${id}`, { method: "DELETE" });
      if (!r.ok) {
        flash("error", getErrorMessage(await r.json(), "Error al cancelar prestamo"));
        return;
      }
      flash("success", "Prestamo cancelado");
      await loadLoans();
    } catch {
      flash("error", "Error de conexion");
    } finally {
      setLoading(false);
    }
  };

  const handleEmployeeForLoan = (employeeId: string) => {
    const employee = employees.find((emp) => emp.id === employeeId);
    setLoanForm((current) => ({ ...current, employeeId, branchId: employee?.branchId ?? current.branchId }));
  };

  const handleManualPaymentDirect = async (id: string) => {
    const amount = Number(manualPaymentAmountStr);
    if (!Number.isFinite(amount) || amount <= 0) {
      flash("error", "Monto inválido");
      return;
    }
    setManualPaymentLoanId(null);
    setManualPaymentAmountStr("");
    setLoading(true);
    try {
      const r = await apiFetch(`/api/payroll/loans/${id}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      if (!r.ok) {
        flash("error", getErrorMessage(await r.json(), "Error al registrar pago"));
        return;
      }
      flash("success", "Pago manual registrado");
      await loadLoans();
    } catch {
      flash("error", "Error de conexion");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── KPI Tiles ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="hm-kpi-tile hm-shine">
          <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: "linear-gradient(90deg, var(--color-info-400), var(--color-info-600))" }} />
          <div className="flex items-center gap-3 pt-1">
            <div className="hm-icon-wrap hm-icon-wrap-sm bg-[var(--color-info-50)] border border-[var(--color-info-100)]">
              <Users className="h-4 w-4 text-[var(--color-info-600)]" />
            </div>
            <div>
              <p className="hm-num-xl">{employees.filter((e) => e.isActive).length}</p>
              <p className="text-xs text-[var(--color-text-soft)]">Empleados activos</p>
            </div>
          </div>
        </div>
        <div className="hm-kpi-tile hm-shine">
          <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: "linear-gradient(90deg, var(--color-success-400), var(--color-success-600))" }} />
          <div className="flex items-center gap-3 pt-1">
            <div className="hm-icon-wrap hm-icon-wrap-sm bg-[var(--color-success-50)] border border-[var(--color-success-100)]">
              <DollarSign className="h-4 w-4 text-[var(--color-success-600)]" />
            </div>
            <div>
              <p className="hm-num-xl">{fmt(employees.filter((e) => e.isActive).reduce((s, e) => s + Number(e.monthlySalary), 0))}</p>
              <p className="text-xs text-[var(--color-text-soft)]">Nómina mensual base</p>
            </div>
          </div>
        </div>
        <div className="hm-kpi-tile hm-shine">
          <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: "linear-gradient(90deg, var(--color-warning-400), var(--color-warning-600))" }} />
          <div className="flex items-center gap-3 pt-1">
            <div className="hm-icon-wrap hm-icon-wrap-sm bg-[var(--color-warning-50)] border border-[var(--color-warning-100)]">
              <Building2 className="h-4 w-4 text-[var(--color-warning-600)]" />
            </div>
            <div>
              <p className="hm-num-xl">{new Set(employees.filter((e) => e.isActive).map((e) => e.branchId)).size}</p>
              <p className="text-xs text-[var(--color-text-soft)]">Sucursales con personal</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="erp-tabs-pill">
        {([
          { key: "employees" as const, label: "Empleados", icon: Users },
          { key: "payroll" as const, label: "Calcular Nómina", icon: Calculator },
          { key: "loans" as const, label: "Préstamos", icon: DollarSign },
          { key: "history" as const, label: "Historial", icon: History },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} className={activeTab === t.key ? "active" : ""}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* ── Branch filter + Add button ── */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-[var(--color-text-secondary)] whitespace-nowrap">Sucursal:</label>
        <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} className="hm-input rounded-lg text-sm">
          <option value="">Todas</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
        </select>
        {activeTab === "employees" && (
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm({ fullName: "", position: "Vendedor", branchId: branches[0]?.id ?? "", monthlySalary: "", startDate: new Date().toISOString().slice(0, 10) }); }}
            className="ml-auto flex items-center gap-2 bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" /> Agregar Empleado
          </button>
        )}
      </div>

      {/* ── Employees tab ── */}
      {activeTab === "employees" && (
        <div className="hm-module-card">
          {showForm && (
            <div className="p-4 border-b border-[var(--color-border)] space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-sm text-[var(--color-text)]">{editingId ? "Editar Empleado" : "Nuevo Empleado"}</p>
                <button onClick={() => { setShowForm(false); setEditingId(null); }} className="hm-icon-btn"><X className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <label className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  Nombre completo *
                  <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case" placeholder="Juan Perez" />
                </label>
                <label className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  Puesto *
                  <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case">
                    {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  Sucursal *
                  <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case">
                    <option value="">Seleccionar...</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  Salario mensual (C$) *
                  <input type="number" step="0.01" min="0.01" value={form.monthlySalary} onChange={(e) => setForm({ ...form, monthlySalary: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case" placeholder="10000" />
                </label>
                <label className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  Fecha de inicio *
                  <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case" />
                </label>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSubmit} disabled={loading} className="flex items-center gap-2 bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {editingId ? "Guardar cambios" : "Crear empleado"}
                </button>
                <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2 rounded-lg text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] transition-colors">Cancelar</button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="hm-table w-full">
              <thead>
                <tr>
                  <th className="text-left">Nombre</th>
                  <th className="text-left">Puesto</th>
                  <th className="text-left">Sucursal</th>
                  <th className="text-right">Salario</th>
                  <th className="text-left">Inicio</th>
                  <th className="text-left">Fin</th>
                  <th className="text-left">Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading && employees.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-[var(--color-info-500)] mx-auto" /></td></tr>
                ) : employees.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-[var(--color-text-soft)]">No hay empleados registrados</td></tr>
                ) : employees.map((emp) => {
                  const isConfirmingDeactivate = confirmDeactivateEmpId === emp.id;
                  return (
                    <tr key={emp.id}>
                      <td className="font-medium text-[var(--color-text)]">{emp.fullName}</td>
                      <td className="text-[var(--color-text-muted)]"><span className="inline-flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" />{emp.position}</span></td>
                      <td className="text-[var(--color-text-muted)]">{emp.branch?.code ?? "—"}</td>
                      <td className="text-right font-mono">{fmt(emp.monthlySalary)}</td>
                      <td className="text-[var(--color-text-muted)]">{new Date(emp.startDate).toLocaleDateString("es-NI")}</td>
                      <td className="text-[var(--color-text-muted)]">{emp.endDate ? new Date(emp.endDate).toLocaleDateString("es-NI") : "—"}</td>
                      <td>
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[0.5625rem] font-semibold ${
                          emp.isActive ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]" : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"
                        }`}>{emp.isActive ? "Activo" : "Inactivo"}</span>
                      </td>
                      <td className="text-right">
                        {isConfirmingDeactivate ? (
                          <div className="flex justify-end items-center gap-1 flex-wrap">
                            <span className="text-xs text-[var(--color-danger-700)]">¿Desactivar?</span>
                            <button onClick={() => { void handleDeactivate(emp.id); setConfirmDeactivateEmpId(null); }} disabled={loading} className="px-2 py-1 bg-[var(--color-danger-600)] text-white rounded text-xs disabled:opacity-50">Sí</button>
                            <button onClick={() => setConfirmDeactivateEmpId(null)} className="px-2 py-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] rounded text-xs">No</button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-1">
                            <button onClick={() => handleEdit(emp)} className="hm-icon-btn text-[var(--color-info-600)]" title="Editar"><Edit2 className="h-4 w-4" /></button>
                            {emp.isActive && (
                              <button onClick={() => setConfirmDeactivateEmpId(emp.id)} disabled={loading} className="hm-icon-btn text-[var(--color-danger-600)] disabled:opacity-50" title="Desactivar">
                                <UserMinus className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Payroll tab ── */}
      {activeTab === "payroll" && (
        <div className="space-y-4">
          <div className="hm-module-card">
            <div className="hm-module-card-header">
              <div className="flex items-center gap-2">
                <Calculator className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                <span className="font-semibold text-sm text-[var(--color-text)]">Calcular Nómina del Mes</span>
              </div>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  Mes
                  <input type="month" value={payrollMonth} onChange={(e) => setPayrollMonth(e.target.value)} className="hm-input rounded-lg text-sm font-normal normal-case" />
                </label>
                <button onClick={handleCalculatePayroll} disabled={loading} className="flex items-center gap-2 bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
                  Calcular nómina
                </button>
                {payrollResult?.payrollRunStatus === "DRAFT" && !confirmPostPayroll && (
                  <button onClick={() => setConfirmPostPayroll(true)} disabled={loading} className="flex items-center gap-2 bg-[var(--color-success-600)] hover:bg-[var(--color-success-700)] text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                    <CheckCircle2 className="h-4 w-4" /> Postear nómina
                  </button>
                )}
                {confirmPostPayroll && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2 text-sm text-[var(--color-warning-700)]">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    <span>¿Postear? Sincroniza gastos y aplica deducciones. No se puede duplicar.</span>
                    <button onClick={() => { void handlePostPayroll(); setConfirmPostPayroll(false); }} disabled={loading} className="px-3 py-1 bg-[var(--color-success-600)] text-white rounded-lg text-xs font-medium disabled:opacity-50">Confirmar</button>
                    <button onClick={() => setConfirmPostPayroll(false)} className="px-3 py-1 text-[var(--color-text-muted)] hover:bg-white/50 rounded-lg text-xs">Cancelar</button>
                  </div>
                )}
              </div>
              <p className="text-xs text-[var(--color-text-soft)]">El cálculo crea un borrador; postear sincroniza gastos de nómina y aplica deducciones de préstamos sin duplicarlas.</p>
            </div>
          </div>

          {payrollResult && (
            <div className="hm-module-card">
              <div className="hm-module-card-header">
                <div>
                  <span className="font-semibold text-sm text-[var(--color-text)]">Resultado: {payrollMonth}</span>
                  <p className="text-xs text-[var(--color-text-muted)]">{payrollResult.employees.length} empleados · {payrollResult.payrollRunStatus}</p>
                </div>
                <div className="hidden sm:flex gap-5 text-right text-sm">
                  <div><p className="font-bold text-[var(--color-text)]">{fmt(payrollResult.totalGross)}</p><p className="text-[0.625rem] text-[var(--color-text-soft)]">Bruto</p></div>
                  <div><p className="font-bold text-[var(--color-warning-700)]">{fmt(payrollResult.totalDeductions)}</p><p className="text-[0.625rem] text-[var(--color-text-soft)]">Deducc.</p></div>
                  <div><p className="font-bold text-[var(--color-success-700)]">{fmt(payrollResult.totalNet)}</p><p className="text-[0.625rem] text-[var(--color-text-soft)]">Neto</p></div>
                  <div><p className="font-bold text-[var(--color-info-700)]">{fmt(payrollResult.totalEmployerCost)}</p><p className="text-[0.625rem] text-[var(--color-text-soft)]">Costo emp.</p></div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="hm-table w-full">
                  <thead>
                    <tr>
                      <th className="text-left">Empleado</th>
                      <th className="text-left">Puesto</th>
                      <th className="text-center">Días</th>
                      <th className="text-right">Bruto</th>
                      <th className="text-right">Préstamos</th>
                      <th className="text-right">Neto</th>
                      <th className="text-right">Costo empresa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollResult.employees.map((emp) => (
                      <tr key={emp.employeeId}>
                        <td className="font-medium text-[var(--color-text)]">{emp.fullName}</td>
                        <td className="text-[var(--color-text-muted)]">{emp.position}</td>
                        <td className="text-center">{emp.daysWorked}/{emp.totalDays}</td>
                        <td className="text-right font-mono">{fmt(emp.grossSalary)}</td>
                        <td className="text-right font-mono text-[var(--color-warning-700)]">{fmt(emp.loanDeductions)}</td>
                        <td className="text-right font-mono font-semibold">{fmt(emp.netPay)}</td>
                        <td className="text-right font-mono">{fmt(emp.employerCost)}</td>
                      </tr>
                    ))}
                    {payrollResult.employees.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-[var(--color-text-soft)]">No hay empleados activos para este periodo</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Loans tab ── */}
      {activeTab === "loans" && (
        <div className="space-y-4">
          <div className="hm-module-card">
            <div className="hm-module-card-header">
              <div className="flex items-center gap-2">
                <DollarSign className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                <span className="font-semibold text-sm text-[var(--color-text)]">Nuevo Préstamo / Adelanto</span>
              </div>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-[var(--color-text-soft)]">Los préstamos no son gasto operativo; se recuperan vía deducción de nómina.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <label className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  Empleado
                  <select value={loanForm.employeeId} onChange={(e) => handleEmployeeForLoan(e.target.value)} className="hm-input rounded-lg text-sm font-normal normal-case">
                    <option value="">Seleccionar...</option>
                    {employees.filter((emp) => emp.isActive).map((emp) => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  Sucursal
                  <select value={loanForm.branchId} onChange={(e) => setLoanForm({ ...loanForm, branchId: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case">
                    <option value="">Seleccionar...</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  Monto (C$)
                  <input type="number" min="0.01" step="0.01" value={loanForm.principalAmount} onChange={(e) => setLoanForm({ ...loanForm, principalAmount: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case" />
                </label>
                <label className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  Cuota mensual
                  <input type="number" min="0.01" step="0.01" value={loanForm.installmentAmount} onChange={(e) => setLoanForm({ ...loanForm, installmentAmount: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case" />
                </label>
                <button onClick={handleCreateLoan} disabled={loading} className="self-end flex items-center justify-center gap-2 bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                  <Plus className="h-4 w-4" /> Registrar
                </button>
                <label className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide sm:col-span-2 lg:col-span-5">
                  Notas
                  <input value={loanForm.notes} onChange={(e) => setLoanForm({ ...loanForm, notes: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case" />
                </label>
              </div>
            </div>
          </div>

          <div className="hm-module-card">
            <div className="hm-module-card-header">
              <span className="font-semibold text-sm text-[var(--color-text)]">Historial de préstamos</span>
              <button onClick={loadLoans} disabled={loading} className="hm-icon-btn disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="hm-table w-full">
                <thead>
                  <tr>
                    <th className="text-left">Empleado</th>
                    <th className="text-left">Sucursal</th>
                    <th className="text-right">Original</th>
                    <th className="text-right">Saldo</th>
                    <th className="text-right">Cuota</th>
                    <th className="text-left">Estado</th>
                    <th className="text-left">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-[var(--color-text-soft)]">Sin préstamos registrados</td></tr>
                  ) : loans.map((loan) => {
                    const isPayingLoan = manualPaymentLoanId === loan.id;
                    const isConfirmingCancel = confirmCancelLoanId === loan.id;
                    return (
                      <tr key={loan.id}>
                        <td className="font-medium text-[var(--color-text)]">{loan.employee.fullName}</td>
                        <td className="text-[var(--color-text-muted)]">{loan.branch.code}</td>
                        <td className="text-right font-mono">{fmt(loan.principalAmount)}</td>
                        <td className="text-right font-mono font-semibold">{fmt(loan.outstandingBalance)}</td>
                        <td className="text-right font-mono">{loan.installmentAmount ? fmt(loan.installmentAmount) : "—"}</td>
                        <td>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[0.5625rem] font-semibold ${
                            loan.status === "ACTIVE" ? "bg-[var(--color-info-100)] text-[var(--color-info-700)]" :
                            loan.status === "PAID" ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]" :
                            "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"
                          }`}>{LOAN_STATUS_LABELS[loan.status] ?? loan.status}</span>
                        </td>
                        <td>
                          {loan.status === "ACTIVE" && (
                            isPayingLoan ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number" min="0.01" step="0.01" placeholder="Monto"
                                  value={manualPaymentAmountStr}
                                  onChange={(e) => setManualPaymentAmountStr(e.target.value)}
                                  className="hm-input h-7 w-24 rounded text-xs"
                                />
                                <button onClick={() => void handleManualPaymentDirect(loan.id)} disabled={loading || !manualPaymentAmountStr} className="px-2 py-1 bg-[var(--color-info-600)] text-white rounded text-xs disabled:opacity-50">OK</button>
                                <button onClick={() => { setManualPaymentLoanId(null); setManualPaymentAmountStr(""); }} className="hm-icon-btn h-6 w-6"><X className="h-3 w-3" /></button>
                              </div>
                            ) : isConfirmingCancel ? (
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-[var(--color-danger-700)]">¿Cancelar?</span>
                                <button onClick={() => { void handleCancelLoan(loan.id); setConfirmCancelLoanId(null); }} disabled={loading} className="px-2 py-1 bg-[var(--color-danger-600)] text-white rounded text-xs disabled:opacity-50">Sí</button>
                                <button onClick={() => setConfirmCancelLoanId(null)} className="px-2 py-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] rounded text-xs">No</button>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <button onClick={() => { setManualPaymentLoanId(loan.id); setManualPaymentAmountStr(""); }} className="text-xs text-[var(--color-info-700)] hover:underline">Pago manual</button>
                                <button onClick={() => setConfirmCancelLoanId(loan.id)} className="text-xs text-[var(--color-danger-700)] hover:underline">Cancelar</button>
                              </div>
                            )
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── History tab ── */}
      {activeTab === "history" && (
        <div className="space-y-4">
          <div className="hm-module-card">
            <div className="hm-module-card-header">
              <span className="font-semibold text-sm text-[var(--color-text)]">Corridas de Nómina</span>
              <button onClick={loadHistory} disabled={loading} className="hm-icon-btn disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="hm-table w-full">
                <thead>
                  <tr>
                    <th className="text-left">Periodo</th>
                    <th className="text-left">Estado</th>
                    <th className="text-right">Bruto</th>
                    <th className="text-right">Deducciones</th>
                    <th className="text-right">Neto</th>
                    <th className="text-right">Costo empresa</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollRuns.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-[var(--color-text-soft)]">Sin corridas formales de nómina.</td></tr>
                  ) : payrollRuns.map((run) => (
                    <tr key={run.payrollRunId}>
                      <td className="text-[var(--color-text)]">{run.year}-{String(run.month).padStart(2, "0")} · {run.employeeCount} empleados</td>
                      <td className="text-[var(--color-text-muted)]">{run.payrollRunStatus}</td>
                      <td className="text-right font-mono">{fmt(run.totalGross)}</td>
                      <td className="text-right font-mono">{fmt(run.totalDeductions)}</td>
                      <td className="text-right font-mono">{fmt(run.totalNet)}</td>
                      <td className="text-right font-mono">{fmt(run.totalEmployerCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="hm-module-card">
            <div className="hm-module-card-header">
              <span className="font-semibold text-sm text-[var(--color-text)]">Historial salarial</span>
            </div>
            <div className="overflow-x-auto">
              <table className="hm-table w-full">
                <thead>
                  <tr>
                    <th className="text-left">Mes</th>
                    <th className="text-left">Empleado</th>
                    <th className="text-left">Puesto</th>
                    <th className="text-center">Días</th>
                    <th className="text-right">Salario completo</th>
                    <th className="text-right">Prorrateado</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-[var(--color-info-500)] mx-auto" /></td></tr>
                  ) : history.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--color-text-soft)]">Sin historial. Calcule la nómina de un mes primero.</td></tr>
                  ) : history.map((h) => (
                    <tr key={h.id}>
                      <td className="text-[var(--color-text-muted)]">{new Date(h.month).toLocaleDateString("es-NI", { year: "numeric", month: "long" })}</td>
                      <td className="font-medium text-[var(--color-text)]">{h.employee.fullName}</td>
                      <td className="text-[var(--color-text-muted)]">{h.employee.position}</td>
                      <td className="text-center">{h.daysWorked}/{h.totalDays}</td>
                      <td className="text-right font-mono text-[var(--color-text-muted)]">{fmt(h.fullSalary)}</td>
                      <td className="text-right font-mono font-semibold text-[var(--color-text)]">{fmt(h.proratedSalary)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
