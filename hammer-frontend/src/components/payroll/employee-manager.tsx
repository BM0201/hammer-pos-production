"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

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
  const [notice, setNotice] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const flash = useCallback((type: "success" | "error", msg: string) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setNotice({ type, msg });
    flashTimerRef.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
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
    if (!confirm("Desactivar este empleado? Se registrara la fecha de finalizacion.")) return;
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
    if (!confirm("Esto sincronizara gastos de nomina y aplicara deducciones de prestamos. No podra duplicarse.")) return;

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
    if (!confirm("Cancelar este prestamo activo? El saldo quedara como historial, sin borrarse.")) return;
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

  const handleManualPayment = async (id: string) => {
    const text = window.prompt("Monto del pago manual");
    if (!text) return;
    const amount = Number(text);
    if (!Number.isFinite(amount) || amount <= 0) {
      flash("error", "Monto invalido");
      return;
    }

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

  const handleEmployeeForLoan = (employeeId: string) => {
    const employee = employees.find((emp) => emp.id === employeeId);
    setLoanForm((current) => ({ ...current, employeeId, branchId: employee?.branchId ?? current.branchId }));
  };

  return (
    <div className="space-y-6">
      {notice && (
        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm font-medium ${
          notice.type === "success" ? "bg-[var(--color-success-50)] text-[var(--color-success-700)] border border-[var(--color-success-100)]" : "bg-[var(--color-danger-50)] text-[var(--color-danger-700)] border border-[var(--color-danger-100)]"
        }`}>
          {notice.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {notice.msg}
        </div>
      )}

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
              <p className="text-2xl font-bold text-[var(--color-text)]">{fmt(employees.filter((e) => e.isActive).reduce((s, e) => s + Number(e.monthlySalary), 0))}</p>
              <p className="text-sm text-[var(--color-text-soft)]">Nomina mensual base</p>
            </div>
          </div>
        </div>
        <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[var(--color-warning-50)] rounded-lg"><Building2 className="h-5 w-5 text-[var(--color-warning-600)]" /></div>
            <div>
              <p className="text-2xl font-bold text-[var(--color-text)]">{new Set(employees.filter((e) => e.isActive).map((e) => e.branchId)).size}</p>
              <p className="text-sm text-[var(--color-text-soft)]">Sucursales con personal</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-1 bg-[var(--color-surface-alt)] rounded-lg p-1 overflow-x-auto">
        {[
          { key: "employees" as const, label: "Empleados", icon: Users },
          { key: "payroll" as const, label: "Calcular Nomina", icon: Calculator },
          { key: "loans" as const, label: "Prestamos / Adelantos", icon: DollarSign },
          { key: "history" as const, label: "Historial", icon: History },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all min-h-[44px] whitespace-nowrap flex-1 justify-center ${
              activeTab === tab.key ? "bg-[var(--color-surface)] text-[var(--color-info-700)] shadow-sm" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            <tab.icon className="h-4 w-4" /> {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-[var(--color-text-secondary)]">Sucursal:</label>
        <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} className="border border-[var(--color-border-strong)] rounded-lg px-3 py-2 text-sm min-h-[44px]">
          <option value="">Todas</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
        </select>
        {activeTab === "employees" && (
          <button onClick={() => { setShowForm(true); setEditingId(null); setForm({ fullName: "", position: "Vendedor", branchId: branches[0]?.id ?? "", monthlySalary: "", startDate: new Date().toISOString().slice(0, 10) }); }} className="ml-auto flex items-center gap-2 bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] text-white px-4 py-2.5 rounded-lg text-sm font-medium min-h-[44px] transition-colors">
            <Plus className="h-4 w-4" /> Agregar Empleado
          </button>
        )}
      </div>

      {activeTab === "employees" && (
        <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] overflow-hidden">
          {showForm && (
            <div className="p-6 border-b border-[var(--color-border)] bg-[var(--color-info-50)]/50">
              <h4 className="font-semibold text-[var(--color-text)] mb-4">{editingId ? "Editar Empleado" : "Nuevo Empleado"}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
                  Nombre completo *
                  <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="mt-1 w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm" placeholder="Juan Perez" />
                </label>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
                  Puesto *
                  <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className="mt-1 w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm">
                    {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
                  Sucursal *
                  <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} className="mt-1 w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm">
                    <option value="">Seleccionar...</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
                  Salario mensual (C$) *
                  <input type="number" step="0.01" min="0.01" value={form.monthlySalary} onChange={(e) => setForm({ ...form, monthlySalary: e.target.value })} className="mt-1 w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm" placeholder="10000" />
                </label>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
                  Fecha de inicio *
                  <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="mt-1 w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm" />
                </label>
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
                ) : employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-[var(--color-surface-alt)] transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-[var(--color-text)]">{emp.fullName}</td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]"><span className="inline-flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" />{emp.position}</span></td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{emp.branch?.code ?? "-"}</td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text)] text-right font-mono">{fmt(emp.monthlySalary)}</td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{new Date(emp.startDate).toLocaleDateString("es-NI")}</td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{emp.endDate ? new Date(emp.endDate).toLocaleDateString("es-NI") : "-"}</td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${emp.isActive ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]" : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"}`}>{emp.isActive ? "Activo" : "Inactivo"}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => handleEdit(emp)} className="p-2 rounded-lg hover:bg-[var(--color-info-50)] text-[var(--color-info-600)] transition-colors" title="Editar"><Edit2 className="h-4 w-4" /></button>
                        {emp.isActive && <button onClick={() => handleDeactivate(emp.id)} disabled={loading} className="p-2 rounded-lg hover:bg-[var(--color-danger-50)] text-[var(--color-danger-600)] transition-colors disabled:opacity-50" title="Desactivar"><UserMinus className="h-4 w-4" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "payroll" && (
        <div className="space-y-4">
          <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] p-6">
            <h4 className="font-semibold text-[var(--color-text)] mb-4">Calcular Nomina del Mes</h4>
            <div className="flex flex-wrap items-end gap-4">
              <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
                Mes
                <input type="month" value={payrollMonth} onChange={(e) => setPayrollMonth(e.target.value)} className="mt-1 border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm min-h-[44px]" />
              </label>
              <button onClick={handleCalculatePayroll} disabled={loading} className="flex items-center gap-2 bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] text-white px-5 py-2.5 rounded-lg text-sm font-medium min-h-[44px] disabled:opacity-50 transition-colors">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
                Calcular nomina
              </button>
              {payrollResult?.payrollRunStatus === "DRAFT" && (
                <button onClick={handlePostPayroll} disabled={loading} className="flex items-center gap-2 bg-[var(--color-success-600)] hover:bg-[var(--color-success-700)] text-white px-5 py-2.5 rounded-lg text-sm font-medium min-h-[44px] disabled:opacity-50 transition-colors">
                  <CheckCircle2 className="h-4 w-4" /> Postear nomina
                </button>
              )}
            </div>
            <p className="text-xs text-[var(--color-text-soft)] mt-2">El calculo crea un borrador; postear sincroniza gastos de nomina y aplica deducciones de prestamos sin duplicarlas.</p>
          </div>

          {payrollResult && (
            <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] overflow-hidden">
              <div className="p-6 border-b border-[var(--color-border)] bg-[var(--color-success-50)]/50">
                <div className="grid gap-4 md:grid-cols-5">
                  <div>
                    <h4 className="font-semibold text-[var(--color-text)]">Resultado: {payrollMonth}</h4>
                    <p className="text-sm text-[var(--color-text-muted)]">{payrollResult.employees.length} empleados - {payrollResult.payrollRunStatus}</p>
                  </div>
                  <div className="text-right"><p className="text-lg font-bold text-[var(--color-text)]">{fmt(payrollResult.totalGross)}</p><p className="text-xs text-[var(--color-text-soft)]">Bruto</p></div>
                  <div className="text-right"><p className="text-lg font-bold text-[var(--color-warning-700)]">{fmt(payrollResult.totalDeductions)}</p><p className="text-xs text-[var(--color-text-soft)]">Deducciones</p></div>
                  <div className="text-right"><p className="text-lg font-bold text-[var(--color-success-700)]">{fmt(payrollResult.totalNet)}</p><p className="text-xs text-[var(--color-text-soft)]">Neto a pagar</p></div>
                  <div className="text-right"><p className="text-lg font-bold text-[var(--color-info-700)]">{fmt(payrollResult.totalEmployerCost)}</p><p className="text-xs text-[var(--color-text-soft)]">Costo empresa</p></div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-[var(--color-surface-alt)] text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Empleado</th>
                      <th className="px-4 py-3">Puesto</th>
                      <th className="px-4 py-3 text-center">Dias</th>
                      <th className="px-4 py-3 text-right">Bruto</th>
                      <th className="px-4 py-3 text-right">Prestamos</th>
                      <th className="px-4 py-3 text-right">Neto</th>
                      <th className="px-4 py-3 text-right">Costo empresa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {payrollResult.employees.map((emp) => (
                      <tr key={emp.employeeId} className="hover:bg-[var(--color-surface-alt)]">
                        <td className="px-4 py-3 text-sm font-medium text-[var(--color-text)]">{emp.fullName}</td>
                        <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{emp.position}</td>
                        <td className="px-4 py-3 text-sm text-center">{emp.daysWorked}/{emp.totalDays}</td>
                        <td className="px-4 py-3 text-sm text-right font-mono">{fmt(emp.grossSalary)}</td>
                        <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-warning-700)]">{fmt(emp.loanDeductions)}</td>
                        <td className="px-4 py-3 text-sm text-right font-mono font-semibold">{fmt(emp.netPay)}</td>
                        <td className="px-4 py-3 text-sm text-right font-mono">{fmt(emp.employerCost)}</td>
                      </tr>
                    ))}
                    {payrollResult.employees.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-[var(--color-text-soft)]">No hay empleados activos para este periodo</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "loans" && (
        <div className="space-y-4">
          <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] p-6">
            <h4 className="font-semibold text-[var(--color-text)] mb-2">Prestamos / Adelantos</h4>
            <p className="text-xs text-[var(--color-text-soft)] mb-4">Los prestamos a empleados no son gasto operativo; se recuperan via deduccion de nomina.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
                Empleado
                <select value={loanForm.employeeId} onChange={(e) => handleEmployeeForLoan(e.target.value)} className="mt-1 w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm">
                  <option value="">Seleccionar...</option>
                  {employees.filter((emp) => emp.isActive).map((emp) => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
                Sucursal
                <select value={loanForm.branchId} onChange={(e) => setLoanForm({ ...loanForm, branchId: e.target.value })} className="mt-1 w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm">
                  <option value="">Seleccionar...</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
                Monto
                <input type="number" min="0.01" step="0.01" value={loanForm.principalAmount} onChange={(e) => setLoanForm({ ...loanForm, principalAmount: e.target.value })} className="mt-1 w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm" />
              </label>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
                Cuota mensual
                <input type="number" min="0.01" step="0.01" value={loanForm.installmentAmount} onChange={(e) => setLoanForm({ ...loanForm, installmentAmount: e.target.value })} className="mt-1 w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm" />
              </label>
              <button onClick={handleCreateLoan} disabled={loading} className="self-end flex items-center justify-center gap-2 bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] text-white px-5 py-2.5 rounded-lg text-sm font-medium min-h-[44px] disabled:opacity-50 transition-colors">
                <Plus className="h-4 w-4" /> Registrar
              </button>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] md:col-span-2 lg:col-span-5">
                Notas
                <input value={loanForm.notes} onChange={(e) => setLoanForm({ ...loanForm, notes: e.target.value })} className="mt-1 w-full border border-[var(--color-border-strong)] rounded-lg px-3 py-2.5 text-sm" />
              </label>
            </div>
          </div>

          <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <h4 className="font-semibold text-[var(--color-text)]">Historial de prestamos</h4>
              <button onClick={loadLoans} disabled={loading} className="p-2 rounded-lg hover:bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] transition-colors disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[var(--color-surface-alt)] text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Empleado</th>
                    <th className="px-4 py-3">Sucursal</th>
                    <th className="px-4 py-3 text-right">Original</th>
                    <th className="px-4 py-3 text-right">Saldo</th>
                    <th className="px-4 py-3 text-right">Cuota</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {loans.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-[var(--color-text-soft)]">Sin prestamos registrados</td></tr>
                  ) : loans.map((loan) => (
                    <tr key={loan.id} className="hover:bg-[var(--color-surface-alt)]">
                      <td className="px-4 py-3 text-sm font-medium text-[var(--color-text)]">{loan.employee.fullName}</td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{loan.branch.code}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">{fmt(loan.principalAmount)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono font-semibold">{fmt(loan.outstandingBalance)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">{loan.installmentAmount ? fmt(loan.installmentAmount) : "-"}</td>
                      <td className="px-4 py-3"><span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]">{LOAN_STATUS_LABELS[loan.status] ?? loan.status}</span></td>
                      <td className="px-4 py-3">
                        {loan.status === "ACTIVE" && (
                          <div className="flex gap-2">
                            <button onClick={() => handleManualPayment(loan.id)} className="text-xs text-[var(--color-info-700)] hover:underline">Pago manual</button>
                            <button onClick={() => handleCancelLoan(loan.id)} className="text-xs text-[var(--color-danger-700)] hover:underline">Cancelar</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === "history" && (
        <div className="space-y-4">
          <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <h4 className="font-semibold text-[var(--color-text)]">PayrollRuns</h4>
              <button onClick={loadHistory} disabled={loading} className="p-2 rounded-lg hover:bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] transition-colors disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[var(--color-surface-alt)] text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Periodo</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Bruto</th>
                    <th className="px-4 py-3 text-right">Deducciones</th>
                    <th className="px-4 py-3 text-right">Neto</th>
                    <th className="px-4 py-3 text-right">Costo empresa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {payrollRuns.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-[var(--color-text-soft)]">Sin corridas formales de nomina.</td></tr>
                  ) : payrollRuns.map((run) => (
                    <tr key={run.payrollRunId} className="hover:bg-[var(--color-surface-alt)]">
                      <td className="px-4 py-3 text-sm text-[var(--color-text)]">{run.year}-{String(run.month).padStart(2, "0")} - {run.employeeCount} empleados</td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{run.payrollRunStatus}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">{fmt(run.totalGross)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">{fmt(run.totalDeductions)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">{fmt(run.totalNet)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">{fmt(run.totalEmployerCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)]">
              <h4 className="font-semibold text-[var(--color-text)]">Historial salarial</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[var(--color-surface-alt)] text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Mes</th>
                    <th className="px-4 py-3">Empleado</th>
                    <th className="px-4 py-3">Puesto</th>
                    <th className="px-4 py-3 text-center">Dias</th>
                    <th className="px-4 py-3 text-right">Salario completo</th>
                    <th className="px-4 py-3 text-right">Prorrateado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {loading ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-[var(--color-info-500)] mx-auto" /></td></tr>
                  ) : history.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--color-text-soft)]">Sin historial. Calcule la nomina de un mes primero.</td></tr>
                  ) : history.map((h) => (
                    <tr key={h.id} className="hover:bg-[var(--color-surface-alt)]">
                      <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{new Date(h.month).toLocaleDateString("es-NI", { year: "numeric", month: "long" })}</td>
                      <td className="px-4 py-3 text-sm font-medium text-[var(--color-text)]">{h.employee.fullName}</td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{h.employee.position}</td>
                      <td className="px-4 py-3 text-sm text-center">{h.daysWorked}/{h.totalDays}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-text-muted)]">{fmt(h.fullSalary)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono font-semibold text-[var(--color-text)]">{fmt(h.proratedSalary)}</td>
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
