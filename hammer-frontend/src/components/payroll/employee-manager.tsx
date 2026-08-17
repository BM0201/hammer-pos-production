"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Users,
  Plus,
  Edit2,
  UserMinus,
  Calculator,
  DollarSign,
  Briefcase,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Wallet,
  X,
  Trash2,
  ClipboardCheck,
  CalendarDays,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { DEFAULT_PAYROLL_RATES, splitNetPayBiweekly, MES_LARGO, type PayrollBreakdown, type PayrollRates } from "@/components/finance/payroll-calc";
import { usePaydayForMonth, type PaydayForMonthEntry } from "@/components/finance/use-payday-for-month";
import { AttendancePanel } from "@/components/finance/attendance-panel";
import { AttendanceCalendar } from "@/components/payroll/attendance-calendar";
import { EmployeeProfileDrawer } from "@/components/payroll/employee-profile-drawer";
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
  /** Retener IR salarial (varía por trabajador). */
  applyIrRetention?: boolean;
  /** Salario cotizable reportado al INSS (null = usar el salario real). */
  inssSalary?: string | null;
  /** Número de cédula de identidad. */
  nationalId?: string | null;
  /** Última liquidación y recontratación (rollover) — null = nunca se liquidó. */
  lastLiquidationAt?: string | null;
  branch: { id: string; code: string; name: string };
  payrollEstimate?: PayrollBreakdown | null;
  payrollRates?: PayrollRates;
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
  /** Desglose visible: al trabajador SOLO se le deduce INSS (+IR si aplica) y préstamos. */
  inssLaboral: number;
  ir: number;
  inssPatronal: number;
  inatec: number;
  provisions: number;
  /** Faltas injustificadas del período: días y pago no devengado (día × salario/30). */
  absenceDays: number;
  absenceDeduction: number;
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
type Disbursement = {
  id: string;
  period: "FIRST_HALF" | "SECOND_HALF";
  amount: string;
  status: "PENDING" | "PAID";
  scheduledDate: string;
  paidAt: string | null;
  employee: { id: string; fullName: string; position: string };
};
type CashStatusRow = {
  branchId: string;
  branchCode: string;
  branchName: string;
  appliedCount: number;
  appliedAmount: number;
  pendingCount: number;
  pendingAmount: number;
};
type EmployeeLoan = {
  id: string;
  employeeId: string;
  branchId: string;
  principalAmount: string;
  outstandingBalance: string;
  installmentAmount: string | null;
  installmentFrequency?: "MONTHLY" | "BIWEEKLY" | string;
  issuedAt: string;
  status: "ACTIVE" | "PAID" | "CANCELLED" | string;
  notes: string | null;
  employee: { id: string; fullName: string; position: string };
  branch: { id: string; code: string; name: string };
};
type ActiveTab = "employees" | "attendance" | "calendar" | "payroll" | "loans" | "history";

/** Clave de persistencia del tab activo de planilla (sobrevive recargas). */
const PAYROLL_TAB_STORAGE_KEY = "hammer.payroll.activeTab";

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

type EmployeeManagerProps = {
  /**
   * Tab fijo para embeber un solo tab dentro de otra vista: Finanzas ›
   * Planilla (payroll-finance-panel.tsx) usa payroll/loans/history y rinde su
   * propio tab Empleados. Sin forcedTab se comporta como siempre (Personal &
   * Roles): barra de tabs propia + persistencia en localStorage.
   */
  forcedTab?: ActiveTab;
  hideTabBar?: boolean;
  /** Oculta los KPI tiles (en Finanzas los reemplaza el hero de costo). */
  hideKpis?: boolean;
  /**
   * Navega al tab "Cortes Quincenales" del contenedor (Planilla): el pago de
   * quincenas vive SOLO ahí — aquí solo se calcula/postea y se ve el estado.
   */
  onGoToCuts?: () => void;
};

export function EmployeeManager({ forcedTab, hideTabBar = false, hideKpis = false, onGoToCuts }: EmployeeManagerProps = {}) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  // Persistimos el tab activo para que la navegación sobreviva a recargas y a
  // volver desde otra pantalla (antes siempre reiniciaba en "Empleados").
  const [activeTab, setActiveTabState] = useState<ActiveTab>(forcedTab ?? "employees");
  useEffect(() => {
    if (forcedTab) {
      setActiveTabState(forcedTab);
      return;
    }
    if (typeof window === "undefined") return;
    // Sin forcedTab esto es RRHH (Finanzas siempre manda forcedTab): solo
    // Empleados/Asistencia son de RRHH — Calcular Nómina/Préstamos/Historial
    // son de Finanzas y no deben quedar guardados como tab de esta pantalla.
    const saved = window.localStorage.getItem(PAYROLL_TAB_STORAGE_KEY);
    if (saved === "employees" || saved === "attendance" || saved === "calendar") {
      setActiveTabState(saved);
    }
  }, [forcedTab]);
  const setActiveTab = useCallback((tab: ActiveTab) => {
    setActiveTabState(tab);
    // Con tab fijo la navegación pertenece al contenedor: no se persiste.
    if (!forcedTab && typeof window !== "undefined") window.localStorage.setItem(PAYROLL_TAB_STORAGE_KEY, tab);
  }, [forcedTab]);
  const [selectedBranch, setSelectedBranch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: "", position: "Vendedor", branchId: "", monthlySalary: "", startDate: "", inssSalary: "", applyIrRetention: false, nationalId: "" });

  const [payrollMonth, setPayrollMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [payrollResult, setPayrollResult] = useState<PayrollResult | null>(null);
  // Vista de cálculo: "MONTH" muestra el total mensual; "BIWEEKLY" divide entre
  // las dos quincenas (mitad), reflejando cómo se desembolsa realmente el pago.
  const [payrollView, setPayrollView] = useState<"MONTH" | "BIWEEKLY">("MONTH");
  // Fechas reales de pago del mes elegido (misma fuente que usará el backend
  // al postear) — para el texto explícito de posteo (§4 del doc).
  const [payrollMonthYear, payrollMonthNum] = payrollMonth.split("-").map(Number);
  const { firstHalf: firstHalfPayday, secondHalf: secondHalfPayday } = usePaydayForMonth(payrollMonthYear, payrollMonthNum);
  const [history, setHistory] = useState<SalaryRecord[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRunSummary[]>([]);

  const [loans, setLoans] = useState<EmployeeLoan[]>([]);
  const [loanForm, setLoanForm] = useState({
    employeeId: "",
    branchId: "",
    principalAmount: "",
    installmentAmount: "",
    installmentFrequency: "MONTHLY" as "MONTHLY" | "BIWEEKLY",
    notes: "",
  });

  // Perfil del trabajador (RRHH): mismo drawer que Finanzas › Planilla —
  // cédula, asistencia, prestaciones acumuladas y liquidación.
  const [drawerEmployeeId, setDrawerEmployeeId] = useState<string | null>(null);
  const drawerEmployee = drawerEmployeeId ? employees.find((e) => e.id === drawerEmployeeId) ?? null : null;
  const payrollRates = useMemo<PayrollRates>(
    () => employees.find((e) => e.payrollRates)?.payrollRates ?? DEFAULT_PAYROLL_RATES,
    [employees],
  );

  // Inline confirmations & payment (replaces window.prompt / confirm)
  const [confirmDeactivateEmpId, setConfirmDeactivateEmpId] = useState<string | null>(null);
  const [confirmCancelLoanId, setConfirmCancelLoanId] = useState<string | null>(null);
  const [confirmPostPayroll, setConfirmPostPayroll] = useState(false);
  const [confirmDeletePayroll, setConfirmDeletePayroll] = useState(false);
  // Borrado de borradores (DRAFT) antiguos directamente desde la tabla de corridas.
  const [confirmDeleteRunId, setConfirmDeleteRunId] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [manualPaymentLoanId, setManualPaymentLoanId] = useState<string | null>(null);
  const [manualPaymentAmountStr, setManualPaymentAmountStr] = useState("");

  const [disbursements, setDisbursements] = useState<Disbursement[]>([]);
  const [cashStatus, setCashStatus] = useState<CashStatusRow[]>([]);

  // Selección "esto sí, esto no" del cálculo: roster de la última corrida
  // COMPLETA + marcas de exclusión (empleado fuera) y de préstamo saltado.
  const [fullRoster, setFullRoster] = useState<PayrollEmployee[]>([]);
  const [excludedEmpIds, setExcludedEmpIds] = useState<Set<string>>(new Set());
  const [skipLoanEmpIds, setSkipLoanEmpIds] = useState<Set<string>>(new Set());

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
  useEffect(() => { setPayrollResult(null); setDisbursements([]); setCashStatus([]); }, [selectedBranch]);

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
        body: JSON.stringify({
          ...form,
          monthlySalary: salaryNum,
          // Vacío = misma base que el salario real (null en DB).
          inssSalary: form.inssSalary.trim() ? Number(form.inssSalary) : null,
        }),
      });
      const raw = await r.json();
      if (!r.ok) {
        flash("error", getErrorMessage(raw, "Error al guardar"));
        return;
      }
      flash("success", editingId ? "Empleado actualizado" : "Empleado creado exitosamente");
      setShowForm(false);
      setEditingId(null);
      setForm({ fullName: "", position: "Vendedor", branchId: "", monthlySalary: "", startDate: "", inssSalary: "", applyIrRetention: false, nationalId: "" });
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
      inssSalary: emp.inssSalary != null ? String(Number(emp.inssSalary)) : "",
      applyIrRetention: emp.applyIrRetention ?? false,
      nationalId: emp.nationalId ?? "",
    });
    setShowForm(true);
  };

  /**
   * Calcula la nómina. Sin argumentos = corrida COMPLETA (resetea la selección
   * y fija el roster). Con `selection` = recalcula "esto sí, esto no": solo
   * los empleados marcados, saltando préstamos donde se desmarcó.
   */
  const handleCalculatePayroll = async (selection?: { includeEmployeeIds: string[]; skipLoanEmployeeIds: string[] }) => {
    if (selection && selection.includeEmployeeIds.length === 0) {
      flash("error", "Marca al menos un empleado para recalcular");
      return;
    }
    setLoading(true);
    try {
      const r = await apiFetch("/api/payroll/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: payrollMonth,
          branchId: selectedBranch || undefined,
          syncToExpenses: false,
          ...(selection ?? {}),
        }),
      });
      const raw = await r.json();
      if (!r.ok) {
        flash("error", getErrorMessage(raw, "Error al calcular nomina"));
        return;
      }
      const data = unwrapApiData(raw) as PayrollResult;
      setPayrollResult(data);
      if (!selection) {
        // Corrida completa: el roster de selección parte de todos los incluidos.
        setFullRoster(data.employees);
        setExcludedEmpIds(new Set());
        setSkipLoanEmpIds(new Set());
      }
      flash("success", `Nomina calculada: ${fmt(data.totalGross)}`);
      if (data.payrollRunStatus === "POSTED") {
        await loadDisbursements(data.payrollRunId);
      } else {
        setDisbursements([]);
        setCashStatus([]);
      }
    } catch {
      flash("error", "Error de conexion al calcular nomina");
    } finally {
      setLoading(false);
    }
  };

  const handleRecalcWithSelection = () =>
    handleCalculatePayroll({
      includeEmployeeIds: fullRoster.filter((e) => !excludedEmpIds.has(e.employeeId)).map((e) => e.employeeId),
      skipLoanEmployeeIds: [...skipLoanEmpIds],
    });

  const loadDisbursements = useCallback(async (runId: string) => {
    try {
      const [disbRes, cashRes] = await Promise.all([
        apiFetch(`/api/payroll/disbursements?payrollRunId=${runId}`),
        apiFetch(`/api/payroll/disbursements/cash-status?payrollRunId=${runId}`),
      ]);
      const disbData = unwrapApiData(await disbRes.json());
      setDisbursements(Array.isArray(disbData) ? (disbData as Disbursement[]) : []);
      const cashData = unwrapApiData(await cashRes.json());
      setCashStatus(Array.isArray(cashData) ? (cashData as CashStatusRow[]) : []);
    } catch {
      setDisbursements([]);
      setCashStatus([]);
    }
  }, []);

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
      await loadDisbursements(data.payrollRunId);
    } catch {
      flash("error", "Error de conexion al postear nomina");
    } finally {
      setLoading(false);
    }
  };

  // Elimina un borrador (DRAFT) de nómina subido por error. El backend bloquea
  // eliminar nóminas ya posteadas o con pagos, evitando descuadres o pagos dobles.
  const handleDeletePayroll = async () => {
    if (!payrollResult?.payrollRunId) return;
    setLoading(true);
    try {
      const r = await apiFetch(`/api/payroll/runs/${payrollResult.payrollRunId}`, { method: "DELETE" });
      const raw = await r.json();
      if (!r.ok) {
        flash("error", getErrorMessage(raw, "Error al eliminar el borrador de nómina"));
        return;
      }
      flash("success", "Borrador de nómina eliminado");
      setPayrollResult(null);
      setDisbursements([]);
      setCashStatus([]);
    } catch {
      flash("error", "Error de conexión al eliminar el borrador");
    } finally {
      setLoading(false);
      setConfirmDeletePayroll(false);
    }
  };

  // Elimina un borrador (DRAFT) antiguo directamente desde la tabla de corridas,
  // sin necesidad de recalcularlo. Útil para limpiar borradores viejos o mal
  // calculados que quedaron atascados. El backend bloquea POSTED o con pagos.
  const handleDeleteRunById = async (runId: string) => {
    setDeletingRunId(runId);
    try {
      const r = await apiFetch(`/api/payroll/runs/${runId}`, { method: "DELETE" });
      const raw = await r.json();
      if (!r.ok) {
        flash("error", getErrorMessage(raw, "Error al eliminar el borrador de nómina"));
        return;
      }
      flash("success", "Borrador de nómina eliminado");
      // Si el borrador borrado es el que está cargado en pantalla, límpialo.
      if (payrollResult?.payrollRunId === runId) {
        setPayrollResult(null);
        setDisbursements([]);
        setCashStatus([]);
      }
      await loadHistory();
    } catch {
      flash("error", "Error de conexión al eliminar el borrador");
    } finally {
      setDeletingRunId(null);
      setConfirmDeleteRunId(null);
    }
  };

  // El PAGO de quincenas vive únicamente en el tab "Cortes Quincenales"
  // (BiweeklyCutsPanel, corte consolidado). Aquí solo se calcula/postea la
  // corrida y se muestra el estado de sus quincenas — un solo flujo de pago.

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
          installmentFrequency: loanForm.installmentFrequency,
          notes: loanForm.notes || null,
        }),
      });
      const raw = await r.json();
      if (!r.ok) {
        flash("error", getErrorMessage(raw, "Error al crear prestamo"));
        return;
      }
      setLoanForm({ employeeId: "", branchId: selectedBranch || "", principalAmount: "", installmentAmount: "", installmentFrequency: "MONTHLY", notes: "" });
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
      {/* ── KPIs (informativos — no filtran la tabla, ver hm-kpi-filter:disabled) ── */}
      {!hideKpis && (
      <div className="flex flex-wrap gap-2">
        <button type="button" className="hm-kpi-filter" disabled>
          <b>{employees.filter((e) => e.isActive).length}</b> empleados activos
        </button>
        <button type="button" className="hm-kpi-filter" disabled>
          <b>
            {employees
              .filter((e) => e.isActive)
              .reduce((s, e) => s + (e.payrollEstimate?.vacationDaysBalance ?? 0), 0)
              .toLocaleString("es-NI", { maximumFractionDigits: 0 })}
          </b> días de vacación acumulados
        </button>
        <button type="button" className="hm-kpi-filter" disabled>
          <b>{new Set(employees.filter((e) => e.isActive).map((e) => e.branchId)).size}</b> sucursales con personal
        </button>
      </div>
      )}

      {/* ── Tab bar (RRHH: solo lo que le compete — Calcular Nómina/Préstamos/
          Historial son de Finanzas y viven allá, embebidos vía forcedTab) ── */}
      {!hideTabBar && (
      <div className="erp-tabs-pill">
        {([
          { key: "employees" as const, label: "Empleados", icon: Users },
          { key: "attendance" as const, label: "Asistencia", icon: ClipboardCheck },
          { key: "calendar" as const, label: "Calendario", icon: CalendarDays },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} className={activeTab === t.key ? "active" : ""}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>
      )}

      {/* ── Branch filter + Add button ── */}
      {activeTab !== "attendance" && activeTab !== "calendar" && (
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-[var(--color-text-secondary)] whitespace-nowrap">Sucursal:</label>
        <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} className="hm-input rounded-lg text-sm">
          <option value="">Todas</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
        </select>
        {activeTab === "employees" && (
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm({ fullName: "", position: "Vendedor", branchId: branches[0]?.id ?? "", monthlySalary: "", startDate: new Date().toISOString().slice(0, 10), inssSalary: "", applyIrRetention: false, nationalId: "" }); }}
            className="ml-auto flex items-center gap-2 bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" /> Agregar Empleado
          </button>
        )}
      </div>
      )}

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
                <label className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide" title="El salario con el que está registrado en el INSS puede ser distinto al real. INSS e INATEC se calculan sobre esta base (así cuadran con la factura del INSS). Vacío = usar el salario real.">
                  Salario INSS (cotizable)
                  <input type="number" step="0.01" min="0.01" value={form.inssSalary} onChange={(e) => setForm({ ...form, inssSalary: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case" placeholder="Ej: 6519.58 (vacío = salario real)" />
                </label>
                <label className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  Número de cédula
                  <input value={form.nationalId} maxLength={20} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case" placeholder="Ej: 401-123456-0001A" />
                </label>
                <label className="flex cursor-pointer select-none items-center gap-2 self-end pb-2 text-[0.78rem] font-normal normal-case tracking-normal text-[var(--color-text-secondary)]" title="El IR salarial (Ley 822) se retiene solo a los trabajadores que no tributan por su cuenta.">
                  <input
                    type="checkbox"
                    checked={form.applyIrRetention}
                    onChange={(e) => setForm({ ...form, applyIrRetention: e.target.checked })}
                    className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-info-600)]"
                  />
                  Retener IR en nómina
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
                    <tr key={emp.id} onClick={() => setDrawerEmployeeId(emp.id)} className="cursor-pointer">
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
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
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

      {/* ── Attendance tab ── */}
      {activeTab === "attendance" && <AttendancePanel />}

      {/* ── Calendario tab ── */}
      {activeTab === "calendar" && <AttendanceCalendar />}

      {/* ── Payroll tab ── */}
      {activeTab === "payroll" && (
        <div className="space-y-4">
          <div className="hm-module-card">
            <div className="hm-module-card-header">
              <div className="flex items-center gap-2">
                <Calculator className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                <span className="font-semibold text-sm text-[var(--color-text)]">{payrollView === "BIWEEKLY" ? "Calcular Nómina por Quincena" : "Calcular Nómina del Mes"}</span>
              </div>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  Mes
                  <input type="month" value={payrollMonth} onChange={(e) => setPayrollMonth(e.target.value)} className="hm-input rounded-lg text-sm font-normal normal-case" />
                </label>
                {/* Selector de vista: calcular por mes completo o dividido por quincena. */}
                <div className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  Período de cálculo
                  <div className="inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-0.5">
                    <button
                      type="button"
                      onClick={() => setPayrollView("MONTH")}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium normal-case transition-colors ${payrollView === "MONTH" ? "bg-[var(--color-info-600)] text-white" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}
                    >
                      Mes completo
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayrollView("BIWEEKLY")}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium normal-case transition-colors ${payrollView === "BIWEEKLY" ? "bg-[var(--color-info-600)] text-white" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}
                    >
                      Por quincena
                    </button>
                  </div>
                </div>
                <button onClick={() => void handleCalculatePayroll()} disabled={loading} className="flex items-center gap-2 bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
                  {payrollView === "BIWEEKLY" ? "Calcular quincena" : "Calcular nómina"}
                </button>
                {payrollResult?.payrollRunStatus === "DRAFT" && !confirmPostPayroll && !confirmDeletePayroll && (
                  <>
                    <button onClick={() => setConfirmPostPayroll(true)} disabled={loading} className="flex items-center gap-2 bg-[var(--color-success-600)] hover:bg-[var(--color-success-700)] text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                      <CheckCircle2 className="h-4 w-4" /> Postear nómina
                    </button>
                    {/* Eliminar borrador: útil cuando la nómina se calculó/subió por error. */}
                    <button onClick={() => setConfirmDeletePayroll(true)} disabled={loading} className="flex items-center gap-2 border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] hover:bg-[var(--color-danger-100)] px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                      <Trash2 className="h-4 w-4" /> Eliminar borrador
                    </button>
                  </>
                )}
                {confirmPostPayroll && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2 text-sm text-[var(--color-warning-700)]">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    <span>¿Postear? Sincroniza gastos y aplica deducciones. No se puede duplicar.</span>
                    <button onClick={() => { void handlePostPayroll(); setConfirmPostPayroll(false); }} disabled={loading} className="px-3 py-1 bg-[var(--color-success-600)] text-white rounded-lg text-xs font-medium disabled:opacity-50">Confirmar</button>
                    <button onClick={() => setConfirmPostPayroll(false)} className="px-3 py-1 text-[var(--color-text-muted)] hover:bg-white/50 rounded-lg text-xs">Cancelar</button>
                  </div>
                )}
                {confirmDeletePayroll && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    <span>¿Eliminar este borrador? Se borra el cálculo y sus desembolsos pendientes. No afecta pagos ya realizados.</span>
                    <button onClick={() => void handleDeletePayroll()} disabled={loading} className="px-3 py-1 bg-[var(--color-danger-600)] text-white rounded-lg text-xs font-medium disabled:opacity-50">Eliminar</button>
                    <button onClick={() => setConfirmDeletePayroll(false)} className="px-3 py-1 text-[var(--color-text-muted)] hover:bg-white/50 rounded-lg text-xs">Cancelar</button>
                  </div>
                )}
                {payrollResult?.payrollRunStatus === "POSTED" && (() => {
                  const firstDisb = disbursements.filter((d) => d.period === "FIRST_HALF");
                  const secondDisb = disbursements.filter((d) => d.period === "SECOND_HALF");
                  const firstPaid = firstDisb.length > 0 && firstDisb.every((d) => d.status === "PAID");
                  const secondPaid = secondDisb.length > 0 && secondDisb.every((d) => d.status === "PAID");
                  const firstTotal = firstDisb.reduce((s, d) => s + Number(d.amount), 0);
                  const secondTotal = secondDisb.reduce((s, d) => s + Number(d.amount), 0);
                  const anyPending = !firstPaid || !secondPaid;
                  return (
                    <div className="flex flex-wrap gap-2">
                      {/* El pago vive SOLO en Cortes Quincenales (un flujo, sin
                          duplicarse con esta pantalla): aquí estado + acceso directo. */}
                      {anyPending && onGoToCuts && (
                        <button
                          onClick={onGoToCuts}
                          className="flex items-center gap-2 rounded-lg border border-transparent bg-[var(--color-info-600)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-info-700)]"
                        >
                          <Wallet className="h-4 w-4" /> Procesar en Cortes Quincenales →
                        </button>
                      )}

                      {/* Estado de las quincenas de ESTA corrida (solo lectura). */}
                      <div className="mt-1 w-full overflow-hidden rounded-xl border border-[var(--color-border)]">
                        {[
                          { key: "FIRST_HALF", label: "1ra quincena (día 15)", paid: firstPaid, total: firstTotal, disb: firstDisb },
                          { key: "SECOND_HALF", label: "2da quincena (fin de mes)", paid: secondPaid, total: secondTotal, disb: secondDisb },
                        ].map((q, i) => {
                          const lastPaidAt = q.disb
                            .filter((d) => d.status === "PAID" && d.paidAt)
                            .map((d) => d.paidAt as string)
                            .sort()
                            .pop();
                          const paidDate = lastPaidAt
                            ? new Date(lastPaidAt).toLocaleDateString("es-NI", { day: "2-digit", month: "2-digit", timeZone: "America/Managua" })
                            : null;
                          return (
                            <div
                              key={q.key}
                              className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-[var(--color-surface-alt)] ${i === 0 ? "border-b border-[var(--color-border)]" : ""}`}
                            >
                              <div className="flex items-center gap-2.5">
                                <span
                                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                                  style={q.paid
                                    ? { background: "var(--color-success-500)", boxShadow: "0 0 0 3px var(--color-success-50)" }
                                    : { background: "var(--color-border-strong)" }}
                                />
                                <div>
                                  <p className="text-sm font-bold text-[var(--color-text)]">
                                    {q.label} — {q.paid ? "pagada" : "pendiente"}
                                  </p>
                                  <p className="text-xs text-[var(--color-text-muted)]">
                                    {q.paid
                                      ? `${fmt(q.total)} desembolsados${paidDate ? ` el ${paidDate}` : ""} — ya cuenta en la utilidad real`
                                      : `${fmt(q.total)} por desembolsar — se paga en Cortes Quincenales`}
                                  </p>
                                </div>
                              </div>
                              {!q.paid && onGoToCuts && (
                                <button onClick={onGoToCuts} className="text-xs font-semibold text-[var(--color-info-600)] hover:underline">
                                  Ir a Cortes Quincenales →
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
              {payrollResult?.payrollRunStatus === "DRAFT" && (() => {
                const totals = payrollResult.employees.reduce(
                  (acc, e) => {
                    const split = splitNetPayBiweekly(e.grossSalary, e.netPay);
                    acc.first += split.firstHalf;
                    acc.second += split.secondHalf;
                    return acc;
                  },
                  { first: 0, second: 0 },
                );
                const fmtPaydayDate = (raw: PaydayForMonthEntry | null) => {
                  if (!raw) return null;
                  const d = new Date(raw.date);
                  return `${d.getUTCDate()} ${MES_LARGO[d.getUTCMonth()].toLowerCase().slice(0, 3)}`;
                };
                const noteFor = (raw: PaydayForMonthEntry | null) =>
                  raw?.adjustedReason === "SUNDAY"
                    ? "el día nominal cae domingo, se adelanta al sábado"
                    : raw?.adjustedReason === "SHORT_MONTH"
                      ? "el mes no llega al día 30"
                      : null;
                const monthLabel =
                  Number.isInteger(payrollMonthNum) && payrollMonthNum >= 1 && payrollMonthNum <= 12
                    ? `${MES_LARGO[payrollMonthNum - 1]} ${payrollMonthYear}`
                    : payrollMonth;
                return (
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 py-3 text-sm">
                    <p className="font-bold text-[var(--color-text)]">Vas a postear: {monthLabel}</p>
                    <div className="mt-1.5 grid gap-1.5 text-[var(--color-text-secondary)] sm:grid-cols-2">
                      <div>
                        <span className="font-semibold">1ª quincena</span> — {fmt(totals.first)}
                        {firstHalfPayday && ` · ${fmtPaydayDate(firstHalfPayday)}`}
                        {noteFor(firstHalfPayday) && (
                          <span className="block text-xs text-[var(--color-warning-600)]">{noteFor(firstHalfPayday)}</span>
                        )}
                      </div>
                      <div>
                        <span className="font-semibold">2ª quincena</span> — {fmt(totals.second)}
                        {secondHalfPayday && ` · ${fmtPaydayDate(secondHalfPayday)}`}
                        {noteFor(secondHalfPayday) && (
                          <span className="block text-xs text-[var(--color-warning-600)]">{noteFor(secondHalfPayday)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
              <p className="text-xs text-[var(--color-text-soft)]">El cálculo crea un borrador; postear sincroniza gastos de nómina y aplica deducciones de préstamos sin duplicarlas.</p>
              {cashStatus.length > 0 && (() => {
                const pendingRows = cashStatus.filter((c) => c.pendingCount > 0);
                const appliedRows = cashStatus.filter((c) => c.appliedCount > 0);
                if (pendingRows.length === 0 && appliedRows.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {appliedRows.map((c) => (
                      <span key={`applied-${c.branchId}`} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-success-200)] bg-[var(--color-success-50)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--color-success-700)]">
                        ✓ {c.branchCode}: {fmt(c.appliedAmount)} descontado de caja
                      </span>
                    ))}
                    {pendingRows.map((c) => (
                      <span key={`pending-${c.branchId}`} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--color-warning-700)]">
                        ⏳ {c.branchCode}: {fmt(c.pendingAmount)} pendiente — se aplicará al abrir caja
                      </span>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>

          {payrollResult && (() => {
            // Vista quincenal: muestra el desglose REAL por quincena — la 1ª
            // paga medio salario completo y las deducciones mensuales
            // (INSS/IR/préstamos, que se cobran UNA vez al mes) caen en la 2ª
            // (misma regla que el desembolso real: biweekly-split.ts).
            const isBiweekly = payrollView === "BIWEEKLY";
            const isDraft = payrollResult.payrollRunStatus === "DRAFT";
            // Roster para la selección: la última corrida COMPLETA (así los
            // excluidos siguen visibles y se pueden volver a marcar).
            const roster = fullRoster.length > 0 ? fullRoster : payrollResult.employees;
            const currentById = new Map(payrollResult.employees.map((e) => [e.employeeId, e]));
            const selectionDirty = excludedEmpIds.size > 0 || skipLoanEmpIds.size > 0;
            const toggleSet = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
              const next = new Set(set);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              setter(next);
            };
            return (
            <div className="hm-module-card">
              <div className="hm-module-card-header">
                <div>
                  <span className="font-semibold text-sm text-[var(--color-text)]">
                    Resultado: {payrollMonth}
                    {isBiweekly && <span className="ml-2 inline-flex items-center rounded-full bg-[var(--color-info-50)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--color-info-700)]">Desglose por quincena</span>}
                  </span>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {payrollResult.employees.length} empleados · {payrollResult.payrollRunStatus}
                    {isBiweekly && " · deducciones mensuales en la 2ª quincena"}
                  </p>
                </div>
                <div className="hidden sm:flex gap-5 text-right text-sm">
                  <div><p className="font-bold text-[var(--color-text)]">{fmt(payrollResult.totalGross)}</p><p className="text-[0.625rem] text-[var(--color-text-soft)]">Bruto (mes)</p></div>
                  <div><p className="font-bold text-[var(--color-warning-700)]">{fmt(payrollResult.totalDeductions)}</p><p className="text-[0.625rem] text-[var(--color-text-soft)]">Deducc. (mes)</p></div>
                  <div><p className="font-bold text-[var(--color-success-700)]">{fmt(payrollResult.totalNet)}</p><p className="text-[0.625rem] text-[var(--color-text-soft)]">Neto (mes)</p></div>
                  <div><p className="font-bold text-[var(--color-info-700)]">{fmt(payrollResult.totalEmployerCost)}</p><p className="text-[0.625rem] text-[var(--color-text-soft)]">Costo emp. (mes)</p></div>
                </div>
              </div>

              {/* Desglose VISIBLE: al trabajador solo se le deduce INSS (+IR si
                  aplica) y préstamos. Prestaciones/INATEC/patronal van en
                  "Costo empresa": las paga el patrón aparte, jamás del salario. */}
              <div className="overflow-x-auto">
                <table className="hm-table w-full">
                  <thead>
                    <tr>
                      {isDraft && <th className="text-center" title="Marcar quién entra en esta corrida">¿Entra?</th>}
                      <th className="text-left">Empleado</th>
                      <th className="text-center">Días</th>
                      <th className="text-right">Bruto</th>
                      <th className="text-right" title="El INSS se cobra UNA vez al mes (factura única): se descuenta completo en la 2ª quincena">INSS laboral</th>
                      <th className="text-right">IR</th>
                      <th className="text-right" title="Faltas injustificadas del mes: cada una descuenta un día de pago (salario ÷ 30)">Faltas</th>
                      <th className="text-right">Préstamos</th>
                      {isBiweekly ? (
                        <>
                          <th className="text-right" title="Medio salario completo, sin deducciones">1ª quincena (día 15)</th>
                          <th className="text-right" title="Medio salario menos TODAS las deducciones del mes (INSS, IR, préstamos)">2ª quincena (fin de mes)</th>
                        </>
                      ) : (
                        <th className="text-right">Neto</th>
                      )}
                      <th className="text-right" title="Salario + INSS patronal + INATEC + prestaciones — lo paga el patrón aparte">Costo empresa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((rosterEmp) => {
                      const excluded = excludedEmpIds.has(rosterEmp.employeeId);
                      const emp = currentById.get(rosterEmp.employeeId);
                      const dim = excluded || !emp;
                      const v = emp ?? rosterEmp;
                      const loanSkipped = skipLoanEmpIds.has(rosterEmp.employeeId);
                      const showLoanToggle = isDraft && (v.loanDeductions > 0 || loanSkipped || rosterEmp.loanDeductions > 0);
                      return (
                        <tr key={rosterEmp.employeeId} className={dim ? "opacity-45" : ""}>
                          {isDraft && (
                            <td className="text-center">
                              <input
                                type="checkbox"
                                checked={!excluded}
                                onChange={() => toggleSet(excludedEmpIds, rosterEmp.employeeId, setExcludedEmpIds)}
                                className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-info-600)]"
                                aria-label={`Incluir a ${rosterEmp.fullName} en la corrida`}
                              />
                            </td>
                          )}
                          <td className="font-medium text-[var(--color-text)]">
                            {rosterEmp.fullName}
                            <span className="block text-[0.7rem] font-normal text-[var(--color-text-muted)]">{rosterEmp.position}</span>
                          </td>
                          <td className="text-center">{dim ? "—" : `${v.daysWorked}/${v.totalDays}`}</td>
                          <td className="text-right font-mono">{dim ? "—" : fmt(v.grossSalary)}</td>
                          {/* INSS/IR son MENSUALES (factura única del INSS): se
                              descuentan completos UNA vez, en la 2ª quincena. */}
                          <td className="text-right font-mono text-[var(--color-danger-600)]">{dim ? "—" : `− ${fmt(v.inssLaboral ?? 0)}`}</td>
                          <td className="text-right font-mono text-[var(--color-danger-600)]">{dim || !(v.ir > 0) ? "—" : `− ${fmt(v.ir)}`}</td>
                          <td className="text-right font-mono text-[var(--color-danger-600)]" title={!dim && v.absenceDays > 0 ? `${v.absenceDays} día(s) de falta injustificada` : undefined}>
                            {dim || !(v.absenceDeduction > 0) ? "—" : `${v.absenceDays}d · − ${fmt(v.absenceDeduction)}`}
                          </td>
                          <td className="text-right font-mono text-[var(--color-warning-700)]">
                            <span className="inline-flex items-center gap-1.5">
                              {showLoanToggle && (
                                <input
                                  type="checkbox"
                                  checked={!loanSkipped}
                                  onChange={() => toggleSet(skipLoanEmpIds, rosterEmp.employeeId, setSkipLoanEmpIds)}
                                  className="h-3 w-3 cursor-pointer accent-[var(--color-warning-600)]"
                                  title="Aplicar la deducción de préstamo en esta corrida (desmarca para no descontarla este mes)"
                                  aria-label={`Aplicar préstamo de ${rosterEmp.fullName}`}
                                />
                              )}
                              {dim ? "—" : v.loanDeductions > 0 ? `− ${fmt(v.loanDeductions)}` : "—"}
                            </span>
                          </td>
                          {isBiweekly ? (
                            (() => {
                              const q = splitNetPayBiweekly(v.grossSalary, v.netPay);
                              return (
                                <>
                                  <td className="text-right font-mono font-semibold text-[var(--color-success-600)]">{dim ? "—" : fmt(q.firstHalf)}</td>
                                  <td className="text-right font-mono font-semibold text-[var(--color-success-600)]">{dim ? "—" : fmt(q.secondHalf)}</td>
                                </>
                              );
                            })()
                          ) : (
                            <td className="text-right font-mono font-semibold text-[var(--color-success-600)]">{dim ? "—" : fmt(v.netPay)}</td>
                          )}
                          <td className="text-right font-mono">{dim ? "—" : fmt(v.employerCost)}</td>
                        </tr>
                      );
                    })}
                    {roster.length === 0 && <tr><td colSpan={(isDraft ? 1 : 0) + (isBiweekly ? 10 : 9)} className="px-4 py-6 text-center text-sm text-[var(--color-text-soft)]">No hay empleados activos para este periodo</td></tr>}
                  </tbody>
                </table>
              </div>

              {isDraft && selectionDirty && (
                <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] px-4 py-3">
                  <button
                    onClick={() => void handleRecalcWithSelection()}
                    disabled={loading}
                    className="flex items-center gap-2 rounded-lg bg-[var(--color-info-600)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-info-700)] disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Recalcular con selección
                  </button>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {excludedEmpIds.size > 0 && `${excludedEmpIds.size} empleado(s) fuera de la corrida. `}
                    {skipLoanEmpIds.size > 0 && `${skipLoanEmpIds.size} préstamo(s) sin descontar este mes. `}
                    &quot;Calcular nómina&quot; vuelve a incluir a todos.
                  </span>
                </div>
              )}

              <div className="border-t border-[var(--color-border)] px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                Al trabajador solo se le deduce <strong>INSS laboral</strong>{" "}
                (+IR si está marcado en su ficha) y <strong>préstamos</strong>. El INSS patronal, el INATEC y las
                prestaciones van dentro de &quot;Costo empresa&quot;: las paga el patrón aparte, nunca del salario.
                {isBiweekly && (
                  <>
                    {" "}<strong>La 1ª quincena paga medio salario completo</strong>; el INSS, el IR y los préstamos
                    (que se cobran <strong>una sola vez al mes</strong>) se descuentan completos en la{" "}
                    <strong>2ª quincena (fin de mes)</strong>. Así la resta cuadra a simple vista: 2ª = ½ salario − deducciones del mes.
                  </>
                )}
              </div>
            </div>
            );
          })()}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
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
                  Frecuencia
                  <select value={loanForm.installmentFrequency} onChange={(e) => setLoanForm({ ...loanForm, installmentFrequency: e.target.value as "MONTHLY" | "BIWEEKLY" })} className="hm-input rounded-lg text-sm font-normal normal-case">
                    <option value="MONTHLY">Mensual</option>
                    <option value="BIWEEKLY">Quincenal</option>
                  </select>
                </label>
                <label className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  {loanForm.installmentFrequency === "BIWEEKLY" ? "Cuota por quincena" : "Cuota mensual"}
                  <input type="number" min="0.01" step="0.01" value={loanForm.installmentAmount} onChange={(e) => setLoanForm({ ...loanForm, installmentAmount: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case" />
                </label>
                <button onClick={handleCreateLoan} disabled={loading} className="self-end flex items-center justify-center gap-2 bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                  <Plus className="h-4 w-4" /> Registrar
                </button>
                <label className="grid gap-1 text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide sm:col-span-2 lg:col-span-6">
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
                        <td className="text-right font-mono">
                          {loan.installmentAmount ? fmt(loan.installmentAmount) : "—"}
                          {loan.installmentAmount && (
                            <span className={`ml-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wide ${loan.installmentFrequency === "BIWEEKLY" ? "bg-[var(--color-info-100)] text-[var(--color-info-700)]" : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"}`}>
                              {loan.installmentFrequency === "BIWEEKLY" ? "Quincenal" : "Mensual"}
                            </span>
                          )}
                        </td>
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
            {/* Aviso: los borradores (DRAFT) pueden eliminarse aquí sin recalcular. */}
            {payrollRuns.some((r) => r.payrollRunStatus === "DRAFT") && (
              <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-2.5 text-xs text-[var(--color-warning-700)]">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>Hay borradores (DRAFT) pendientes. Puedes eliminar los que quedaron atascados o mal calculados con el botón <strong>Eliminar</strong>. No afecta nóminas ya posteadas.</span>
              </div>
            )}
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
                    <th className="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollRuns.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-[var(--color-text-soft)]">Sin corridas formales de nómina.</td></tr>
                  ) : payrollRuns.map((run) => {
                    const isDraft = run.payrollRunStatus === "DRAFT";
                    const isConfirming = confirmDeleteRunId === run.payrollRunId;
                    const isDeleting = deletingRunId === run.payrollRunId;
                    return (
                    <tr key={run.payrollRunId}>
                      <td className="text-[var(--color-text)]">{run.year}-{String(run.month).padStart(2, "0")} · {run.employeeCount} empleados</td>
                      <td>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[0.5625rem] font-bold ${
                          isDraft
                            ? "bg-[var(--color-warning-100)] text-[var(--color-warning-700)]"
                            : "bg-[var(--color-success-100)] text-[var(--color-success-700)]"
                        }`}>
                          {isDraft ? "BORRADOR" : run.payrollRunStatus}
                        </span>
                      </td>
                      <td className="text-right font-mono">{fmt(run.totalGross)}</td>
                      <td className="text-right font-mono">{fmt(run.totalDeductions)}</td>
                      <td className="text-right font-mono">{fmt(run.totalNet)}</td>
                      <td className="text-right font-mono">{fmt(run.totalEmployerCost)}</td>
                      <td className="text-right">
                        {isDraft ? (
                          isConfirming ? (
                            <div className="flex justify-end items-center gap-1.5">
                              <span className="text-[0.6875rem] text-[var(--color-danger-700)]">¿Eliminar?</span>
                              <button
                                onClick={() => void handleDeleteRunById(run.payrollRunId)}
                                disabled={isDeleting}
                                className="px-2 py-1 bg-[var(--color-danger-600)] text-white rounded-md text-[0.6875rem] font-medium disabled:opacity-50"
                              >
                                {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Sí"}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteRunId(null)}
                                disabled={isDeleting}
                                className="px-2 py-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] rounded-md text-[0.6875rem]"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteRunId(run.payrollRunId)}
                              className="inline-flex items-center gap-1 border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] hover:bg-[var(--color-danger-100)] px-2.5 py-1 rounded-md text-[0.6875rem] font-medium transition-colors"
                              title="Eliminar borrador atascado"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Eliminar
                            </button>
                          )
                        ) : (
                          <span className="text-[0.6875rem] text-[var(--color-text-soft)]">—</span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
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

      <EmployeeProfileDrawer
        employee={drawerEmployee}
        rates={payrollRates}
        onClose={() => setDrawerEmployeeId(null)}
        onChanged={loadEmployees}
        onEdit={drawerEmployee ? () => { handleEdit(drawerEmployee); setDrawerEmployeeId(null); } : undefined}
      />
    </div>
  );
}
