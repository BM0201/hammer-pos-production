"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  Briefcase,
  Calculator,
  CalendarClock,
  CalendarDays,
  CalendarX2,
  CheckCircle2,
  Download,
  DollarSign,
  Edit2,
  History,
  Info,
  Loader2,
  Plus,
  Search,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { EmployeeManager } from "@/components/payroll/employee-manager";
import { BiweeklyCutsPanel } from "@/components/payroll/biweekly-cuts-panel";
import { EmployeeProfileDrawer } from "@/components/payroll/employee-profile-drawer";
import { AttendancePanel } from "./attendance-panel";
import { PayrollCostHero, type PayrollHeroTotals } from "./payroll-cost-hero";
import {
  DEFAULT_PAYROLL_RATES,
  MES_LARGO,
  computeMonthlyBreakdown,
  fmtC,
  fmtDateShort,
  fmtRatePct3,
  initials,
  nextBiweeklyPayday,
  round2,
  type PayrollBreakdown,
  type PayrollRates,
} from "./payroll-calc";

/**
 * Finanzas & Contabilidad › Planilla — tab Empleados (Planilla V2).
 *
 * Ejecuta el TODO(finance-extract): la UI de planilla vive aquí en lugar de
 * seguir engordando employee-manager.tsx. Los tabs Calcular Nómina / Préstamos /
 * Historial se reutilizan de EmployeeManager (forcedTab) hasta extraerlos.
 *
 * Los valores de neto/costo por empleado vienen del backend
 * (payrollEstimate en /api/employees); si el endpoint aún no expone el
 * desglose, se calculan en cliente con las mismas tasas y las columnas se
 * marcan con el badge "ESTIMADO".
 */

type Branch = { id: string; code: string; name: string };

type EmployeeRow = {
  id: string;
  fullName: string;
  position: string;
  branchId: string;
  monthlySalary: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  /** Retener IR salarial a este trabajador (varía por persona). */
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

type PanelTab = "employees" | "payroll" | "cuts" | "attendance" | "loans" | "history";
type SortKey = "name" | "salary" | "start";

const BANNER_DISMISS_KEY = "hammer.finance.payrollBanner.dismissed";
const POSITIONS = ["Supervisor", "Vendedor", "Cajero", "Bodeguero", "Administrador", "Auxiliar", "Otro"];

/** Ciclo de acentos por sucursal (dot) y avatar (fondo/texto) — solo tokens. */
const BRANCH_ACCENTS = ["info", "owner", "sales", "success", "warning", "master"] as const;
const AVATAR_ACCENTS = ["info", "owner", "success", "sales", "master", "warning"] as const;

function hashIndex(id: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % mod;
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const data = payload as { error?: { message?: string } | string; message?: string };
    if (typeof data.error === "string") return data.error;
    if (data.error?.message) return data.error.message;
    if (data.message) return data.message;
  }
  return fallback;
}

export function PayrollFinancePanel() {
  const [tab, setTab] = useState<PanelTab>("employees");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [includeProvisions, setIncludeProvisions] = useState(true);
  const provisionsTouched = useRef(false);

  // Pago mensual de las facturas del patrón (INSS/INATEC): registro CONTABLE
  // de si la factura del período ya se pagó (el INSS se cobra 1 vez al mes).
  const [contributionPayments, setContributionPayments] = useState<Array<{ kind: string; amount: string | number; paidAt: string }>>([]);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);

  const loadContributionPayments = useCallback(async () => {
    try {
      const d = new Date();
      const r = await apiFetch(`/api/payroll/contribution-payments?year=${d.getFullYear()}&month=${d.getMonth() + 1}`);
      if (!r.ok) return;
      const data = unwrapApiData(await r.json()) as { payments?: Array<{ kind: string; amount: string | number; paidAt: string }> } | null;
      setContributionPayments(Array.isArray(data?.payments) ? data.payments : []);
    } catch {
      /* estado complementario */
    }
  }, []);

  useEffect(() => { void loadContributionPayments(); }, [loadContributionPayments]);

  async function markContributionPaid(kind: "INSS" | "INATEC", amount: number) {
    setMarkingPaid(kind);
    try {
      const d = new Date();
      const r = await apiFetch("/api/payroll/contribution-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: d.getFullYear(), month: d.getMonth() + 1, kind, amount }),
      });
      if (!r.ok) {
        toast.error(getErrorMessage(await r.json(), "No se pudo marcar como pagada"));
        return;
      }
      toast.success(`Factura ${kind} del mes marcada como pagada`);
      await loadContributionPayments();
    } catch {
      toast.error("Error de conexión");
    } finally {
      setMarkingPaid(null);
    }
  }

  const [bannerDismissed, setBannerDismissed] = useState(true);
  const [drawerEmployeeId, setDrawerEmployeeId] = useState<string | null>(null);

  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: "", position: "Vendedor", branchId: "", monthlySalary: "", startDate: "", applyIrRetention: false, inssSalary: "", nationalId: "" });

  const searchRef = useRef<HTMLInputElement>(null);

  /* ── Carga de datos ── */

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
      // Se cargan TODOS y se filtra en cliente: así el select de sucursal puede
      // mostrar el conteo por opción y el hero recalcula sin ir al servidor.
      const r = await fetch("/api/employees");
      const j = unwrapApiData(await r.json());
      const list = Array.isArray(j) ? (j as EmployeeRow[]) : [];
      setEmployees(list);
      // Default del control de prestaciones desde la config del backend (una
      // vez): las tres comparten el control, aguinaldoMode marca el default.
      const rates = list.find((e) => e.payrollRates)?.payrollRates;
      if (rates && !provisionsTouched.current) setIncludeProvisions(rates.aguinaldoMode === "ACCRUE_MONTHLY");
    } catch {
      toast.error("Error al cargar empleados");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadEmployees(); }, [loadEmployees]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setBannerDismissed(window.localStorage.getItem(BANNER_DISMISS_KEY) === "1");
  }, []);

  /* ── Atajos de teclado: "/" busca, Escape cierra el drawer ── */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA");
      if (e.key === "/" && !typing && tab === "employees") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") setDrawerEmployeeId(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tab]);

  /* ── Cálculo ── */

  const rates = useMemo<PayrollRates>(
    () => employees.find((e) => e.payrollRates)?.payrollRates ?? DEFAULT_PAYROLL_RATES,
    [employees],
  );

  // Desglose por empleado: backend si existe; espejo cliente como fallback
  // (startDate define el tramo de indemnización y las prestaciones acumuladas).
  const breakdownOf = useCallback(
    (emp: EmployeeRow): { b: PayrollBreakdown; estimated: boolean } => {
      if (emp.payrollEstimate) return { b: emp.payrollEstimate, estimated: false };
      return {
        b: computeMonthlyBreakdown(
          Number(emp.monthlySalary),
          rates,
          emp.startDate,
          emp.applyIrRetention ?? false,
          emp.inssSalary != null ? Number(emp.inssSalary) : undefined,
        ),
        estimated: true,
      };
    },
    [rates],
  );

  const employerCostOf = useCallback(
    (b: PayrollBreakdown) => round2(b.employerCost - (includeProvisions ? 0 : b.provisions)),
    [includeProvisions],
  );

  const anyEstimated = useMemo(
    () => employees.some((e) => e.isActive && !e.payrollEstimate),
    [employees],
  );

  /* ── Listas derivadas ── */

  // Scope de los totales: sucursal + selección unitaria de empleado. Con un
  // empleado seleccionado, el hero, la tabla y el CSV muestran SOLO a esa
  // persona (desglose individual completo).
  const inBranchScope = useCallback(
    (emp: EmployeeRow) =>
      (!selectedBranch || emp.branchId === selectedBranch) && (!selectedEmployee || emp.id === selectedEmployee),
    [selectedBranch, selectedEmployee],
  );

  const visibleEmployees = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = employees.filter(
      (e) => inBranchScope(e) && (!q || e.fullName.toLowerCase().includes(q) || e.position.toLowerCase().includes(q)),
    );
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.fullName.localeCompare(b.fullName, "es");
      else if (sortKey === "salary") cmp = Number(a.monthlySalary) - Number(b.monthlySalary);
      else cmp = a.startDate.localeCompare(b.startDate);
      return cmp * sortDir;
    });
    return list;
  }, [employees, inBranchScope, query, sortKey, sortDir]);

  // Base de % nómina y del hero: empleados ACTIVOS del scope de sucursal
  // (la búsqueda no altera los totales, igual que el mockup).
  const heroTotals = useMemo<PayrollHeroTotals>(() => {
    const active = employees.filter((e) => e.isActive && inBranchScope(e));
    const t = { base: 0, net: 0, ret: 0, patronal: 0, inatec: 0, agui: 0, vac: 0, indem: 0, cost: 0 };
    for (const emp of active) {
      const { b } = breakdownOf(emp);
      t.base += Number(emp.monthlySalary);
      t.net += b.netPay;
      t.ret += b.inssLaboral + b.ir;
      t.patronal += b.inssPatronal;
      t.inatec += b.inatec;
      if (includeProvisions) {
        t.agui += b.aguinaldoAccrual;
        t.vac += b.vacacionesAccrual;
        t.indem += b.indemnizacionAccrual;
      }
      t.cost += employerCostOf(b);
    }
    return {
      base: round2(t.base),
      net: round2(t.net),
      ret: round2(t.ret),
      patronal: round2(t.patronal),
      inatec: round2(t.inatec),
      agui: round2(t.agui),
      vac: round2(t.vac),
      indem: round2(t.indem),
      cost: round2(t.cost),
      activeEmployees: active.length,
      branchCount: new Set(active.map((e) => e.branchId)).size,
    };
  }, [employees, inBranchScope, breakdownOf, employerCostOf, includeProvisions]);

  const activeBaseTotal = heroTotals.base;

  const branchAccent = useCallback(
    (branchId: string) => {
      const idx = branches.findIndex((b) => b.id === branchId);
      return BRANCH_ACCENTS[(idx >= 0 ? idx : hashIndex(branchId, BRANCH_ACCENTS.length)) % BRANCH_ACCENTS.length];
    },
    [branches],
  );

  const now = new Date();
  const periodLabel = `${MES_LARGO[now.getMonth()]} ${now.getFullYear()}`;
  const payday = nextBiweeklyPayday(now);

  // "Planilla del patrón": lo que llega en las facturas del INSS y del INATEC
  // (mismo formato del documento real: CUOTA LABORAL + CUOTA PATRONAL = total
  // INSS; INATEC 2% aparte). La cuota laboral ya se retuvo al trabajador; la
  // patronal y el INATEC los paga el patrón de su bolsillo. Vencen ~17 del mes
  // siguiente al período facturado.
  const patronInvoice = useMemo(() => {
    const active = employees.filter((e) => e.isActive && inBranchScope(e));
    let laboral = 0;
    let patronal = 0;
    let inatec = 0;
    for (const emp of active) {
      const { b } = breakdownOf(emp);
      laboral += b.inssLaboral;
      patronal += b.inssPatronal;
      inatec += b.inatec;
    }
    const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 17);
    return {
      laboral: round2(laboral),
      patronal: round2(patronal),
      inssTotal: round2(laboral + patronal),
      inatec: round2(inatec),
      dueLabel: `${dueDate.getDate()} ${MES_LARGO[dueDate.getMonth()].toLowerCase().slice(0, 3)} ${dueDate.getFullYear()}`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, inBranchScope, breakdownOf]);

  /* ── Acciones ── */

  function dismissBanner() {
    setBannerDismissed(true);
    if (typeof window !== "undefined") window.localStorage.setItem(BANNER_DISMISS_KEY, "1");
  }

  function openCreateForm() {
    setEditingId(null);
    setForm({
      fullName: "",
      position: "Vendedor",
      branchId: selectedBranch || branches[0]?.id || "",
      monthlySalary: "",
      startDate: new Date().toISOString().slice(0, 10),
      applyIrRetention: false,
      inssSalary: "",
      nationalId: "",
    });
    setShowForm(true);
    setTab("employees");
  }

  function openEditForm(emp: EmployeeRow) {
    setEditingId(emp.id);
    setForm({
      fullName: emp.fullName,
      position: emp.position,
      branchId: emp.branchId,
      monthlySalary: emp.monthlySalary,
      startDate: emp.startDate.slice(0, 10),
      applyIrRetention: emp.applyIrRetention ?? false,
      inssSalary: emp.inssSalary != null ? String(Number(emp.inssSalary)) : "",
      nationalId: emp.nationalId ?? "",
    });
    setShowForm(true);
    setDrawerEmployeeId(null);
  }

  async function handleSubmitForm() {
    if (!form.fullName.trim() || !form.branchId || !form.startDate) {
      toast.error("Complete todos los campos requeridos");
      return;
    }
    const salaryNum = parseFloat(form.monthlySalary);
    if (!form.monthlySalary || Number.isNaN(salaryNum) || salaryNum <= 0) {
      toast.error("El salario debe ser un número mayor a 0");
      return;
    }
    setLoading(true);
    try {
      const url = editingId ? `/api/employees/${editingId}` : "/api/employees";
      const r = await apiFetch(url, {
        method: editingId ? "PUT" : "POST",
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
        toast.error(getErrorMessage(raw, "Error al guardar"));
        return;
      }
      toast.success(editingId ? "Empleado actualizado" : "Empleado creado exitosamente");
      setShowForm(false);
      setEditingId(null);
      await loadEmployees();
    } catch {
      toast.error("Error de conexión al guardar");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeactivate(id: string) {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/employees/${id}`, { method: "DELETE" });
      if (!r.ok) {
        toast.error(getErrorMessage(await r.json(), "Error al desactivar"));
        return;
      }
      toast.success("Empleado desactivado");
      setDrawerEmployeeId(null);
      await loadEmployees();
    } catch {
      toast.error("Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  function clearFilters() {
    setQuery("");
    setSelectedBranch("");
    setSelectedEmployee("");
  }

  function exportCsv() {
    const header = [
      "Nombre", "Puesto", "Sucursal", "Salario base", "INSS laboral", "IR", "Neto a pagar",
      "INSS patronal", "INATEC",
      "Prov. aguinaldo", "Prov. vacaciones", "Prov. indemnización",
      "Costo empresa", "% Nómina",
      "Antigüedad (meses)", "Aguinaldo acumulado", "Días vacaciones (saldo)", "Valor vacaciones",
      "Indemnización acumulada", "Tramo indemnización",
      "Inicio", "Fin", "Estado",
    ];
    const tramoLabel = (rate: number | undefined) => {
      if (rate === undefined) return "";
      if (rate === 0) return "Tope 5 meses (0%)";
      return rate > 1 / 12 - 1e-9 ? "Años 1–3 (8.333%)" : "Años 4–6 (5.556%)";
    };
    const rows = visibleEmployees.map((emp) => {
      const { b } = breakdownOf(emp);
      const salary = Number(emp.monthlySalary);
      const share = activeBaseTotal > 0 && emp.isActive ? ((salary / activeBaseTotal) * 100).toFixed(1) + "%" : "";
      return [
        emp.fullName, emp.position, emp.branch?.name ?? "", salary.toFixed(2),
        b.inssLaboral.toFixed(2), b.ir.toFixed(2), b.netPay.toFixed(2),
        b.inssPatronal.toFixed(2), b.inatec.toFixed(2),
        (includeProvisions ? b.aguinaldoAccrual : 0).toFixed(2),
        (includeProvisions ? b.vacacionesAccrual : 0).toFixed(2),
        (includeProvisions ? b.indemnizacionAccrual : 0).toFixed(2),
        employerCostOf(b).toFixed(2), share,
        (b.monthsOfService ?? 0).toFixed(1),
        (b.aguinaldoAccrued ?? 0).toFixed(2),
        (b.vacationDaysBalance ?? 0).toFixed(1),
        (b.vacationBalanceValue ?? 0).toFixed(2),
        (b.indemnizacionAccrued ?? 0).toFixed(2),
        tramoLabel(b.indemnizacionRateActual),
        emp.startDate.slice(0, 10), emp.endDate?.slice(0, 10) ?? "",
        emp.isActive ? "Activo" : "Inactivo",
      ];
    });
    const csv = [header, ...rows].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `planilla-${MES_LARGO[now.getMonth()].toLowerCase()}-${now.getFullYear()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("CSV exportado");
  }

  /* ── Render ── */

  const drawerEmployee = drawerEmployeeId ? employees.find((e) => e.id === drawerEmployeeId) ?? null : null;

  const groups = useMemo(() => {
    if (selectedBranch) return [{ branch: null as Branch | null, items: visibleEmployees }];
    return branches
      .map((b) => ({ branch: b as Branch | null, items: visibleEmployees.filter((e) => e.branchId === b.id) }))
      .filter((g) => g.items.length > 0);
  }, [branches, selectedBranch, visibleEmployees]);

  const visibleTotals = useMemo(() => {
    const t = { base: 0, net: 0, cost: 0 };
    for (const emp of visibleEmployees) {
      const { b } = breakdownOf(emp);
      t.base += Number(emp.monthlySalary);
      t.net += b.netPay;
      t.cost += employerCostOf(b);
    }
    return { base: round2(t.base), net: round2(t.net), cost: round2(t.cost) };
  }, [visibleEmployees, breakdownOf, employerCostOf]);

  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === 1 ? "▲" : "▼") : "");

  let rowDelay = 0;

  return (
    <div className="space-y-4">
      {/* ── 1 · Header del panel ── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="flex flex-wrap items-center gap-2.5 text-lg font-extrabold tracking-tight text-[var(--color-text)]">
          Planilla
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-0.5 text-xs font-semibold text-[var(--color-text-secondary)] shadow-[var(--shadow-xs)]">
            <CalendarDays className="h-3 w-3" />
            {periodLabel}
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-success-100)] bg-[var(--color-success-50)] px-3 py-0.5 text-xs font-semibold text-[var(--color-success-700)]"
            title={payday.adjustedNote ? `${payday.adjustedNote} — para pagar bien y a tiempo` : undefined}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success-500)]" />
            Próximo pago: {payday.label}
            {payday.adjusted && <span className="font-bold" aria-hidden="true">*</span>}
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={openCreateForm}
            className="flex items-center gap-2 rounded-lg border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--color-text-secondary)] shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-alt)]"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar Empleado
          </button>
          <button
            onClick={() => setTab("payroll")}
            className="flex items-center gap-2 rounded-lg bg-[var(--color-info-600)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-info-700)]"
          >
            <Calculator className="h-4 w-4" /> Calcular nómina
          </button>
        </div>
      </div>

      {/* ── 2 · Banner informativo (descartable) ── */}
      {!bannerDismissed && (
        <div className="hm-alert hm-alert-info flex items-start gap-2" role="note">
          <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            El cálculo de planilla, costo patronal y neto a pagar vive aquí (Finanzas). Para editar la
            ficha del empleado (datos, roles, sucursales) ve a{" "}
            <Link href={"/app/master/users" as Route} className="font-semibold underline">RRHH</Link>.
          </div>
          <button onClick={dismissBanner} aria-label="Cerrar aviso" className="ml-auto rounded-md p-0.5 opacity-70 transition-opacity hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── 3 · Hero de costo (reemplaza los KPI tiles) ── */}
      <PayrollCostHero
        totals={heroTotals}
        periodLabel={periodLabel}
        branchLabel={
          selectedEmployee
            ? employees.find((e) => e.id === selectedEmployee)?.fullName ?? null
            : selectedBranch
              ? (() => {
                  const b = branches.find((x) => x.id === selectedBranch);
                  return b ? `${b.code} — ${b.name}` : null;
                })()
              : null
        }
        provisionsIncluded={includeProvisions}
        rates={rates}
        estimated={anyEstimated}
      />

      {/* ── 3b · Planilla del patrón: las facturas que llegan (INSS + INATEC) ── */}
      {heroTotals.activeEmployees > 0 && (
        <div className="hm-module-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[0.8125rem] font-bold text-[var(--color-text)]">
              Facturas del patrón · {periodLabel}
              <span className="ml-2 rounded-full border border-[var(--color-warning-100)] bg-[var(--color-warning-50)] px-2 py-0.5 text-[0.5938rem] font-bold uppercase tracking-wide text-[var(--color-warning-700)]">
                Se pagan aparte · vencen ≈ {patronInvoice.dueLabel}
              </span>
            </h3>
            <span className="text-[0.6875rem] text-[var(--color-text-soft)]">
              Estimado con los salarios actuales — la factura oficial la emite el INSS/INATEC
            </span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(() => {
              const paidChip = (kind: "INSS" | "INATEC", amount: number) => {
                const paid = contributionPayments.find((p) => p.kind === kind);
                if (paid) {
                  return (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-success-100)] bg-[var(--color-success-50)] px-2 py-0.5 text-[0.625rem] font-bold text-[var(--color-success-700)]">
                      ✓ Pagada {fmtDateShort(paid.paidAt)} · {fmtC(Number(paid.amount))}
                    </span>
                  );
                }
                return (
                  <button
                    onClick={() => void markContributionPaid(kind, amount)}
                    disabled={markingPaid === kind || amount <= 0}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-2 py-0.5 text-[0.625rem] font-bold text-[var(--color-warning-700)] transition-colors hover:bg-[var(--color-warning-100)] disabled:opacity-50"
                    title="Registro contable: marca la factura del mes como pagada (no toca caja ni genera otro gasto — el costo ya vive en el costo laboral)."
                  >
                    {markingPaid === kind ? "Guardando…" : "Pendiente — marcar pagada"}
                  </button>
                );
              };
              return (
                <>
                  {/* Espejo de la factura del INSS: laboral + patronal = total */}
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.06em] text-[var(--color-text-muted)]">Factura INSS (Régimen {rates.inssRegime === "IVM_RP" ? "IVM-RP" : "Integral"})</p>
                      {paidChip("INSS", patronInvoice.inssTotal)}
                    </div>
                    <div className="mt-1.5 space-y-1 text-[0.8125rem]">
                      <div className="flex items-baseline justify-between"><span className="text-[var(--color-text-secondary)]">Cuota laboral <small className="text-[0.6875rem] text-[var(--color-text-soft)]">retenida a los trabajadores</small></span><span className="font-mono tabular-nums">{fmtC(patronInvoice.laboral)}</span></div>
                      <div className="flex items-baseline justify-between"><span className="text-[var(--color-text-secondary)]">Cuota patronal <small className="text-[0.6875rem] text-[var(--color-text-soft)]">la paga el patrón</small></span><span className="font-mono tabular-nums">{fmtC(patronInvoice.patronal)}</span></div>
                      <div className="flex items-baseline justify-between border-t border-[var(--color-border-strong)] pt-1 font-bold"><span className="text-[var(--color-text)]">Total a pagar al INSS</span><span className="font-mono tabular-nums text-[var(--color-warning-600)]">{fmtC(patronInvoice.inssTotal)}</span></div>
                    </div>
                    <p className="mt-2 text-[0.6875rem] leading-relaxed text-[var(--color-text-soft)]">
                      El INSS se cobra <strong>una vez al mes</strong> (no por quincena): la factura de {periodLabel.toLowerCase()} vence ≈ {patronInvoice.dueLabel}.
                      Calculado sobre el salario COTIZABLE de cada trabajador.
                    </p>
                  </div>
                  {/* Espejo de la factura del INATEC (aporte 2%) */}
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.06em] text-[var(--color-text-muted)]">Factura INATEC (aporte 2%)</p>
                      {paidChip("INATEC", patronInvoice.inatec)}
                    </div>
                    <div className="mt-1.5 space-y-1 text-[0.8125rem]">
                      <div className="flex items-baseline justify-between"><span className="text-[var(--color-text-secondary)]">2% sobre la base cotizable <small className="text-[0.6875rem] text-[var(--color-text-soft)]">la paga el patrón</small></span><span className="font-mono tabular-nums">{fmtC(patronInvoice.inatec)}</span></div>
                      <div className="flex items-baseline justify-between border-t border-[var(--color-border-strong)] pt-1 font-bold"><span className="text-[var(--color-text)]">Total a pagar al INATEC</span><span className="font-mono tabular-nums text-[var(--color-warning-600)]">{fmtC(patronInvoice.inatec)}</span></div>
                    </div>
                    <p className="mt-2 text-[0.6875rem] leading-relaxed text-[var(--color-text-soft)]">
                      Ninguna de estas facturas sale del salario del trabajador: a él solo se le retiene la cuota laboral,
                      que el patrón entera al INSS junto con la patronal.
                    </p>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── 4 · Tabs (mismos del sistema) ──
          "Cortes Quincenales" vive AQUÍ (antes era un tab aparte en Finanzas y
          duplicaba el pago que también ofrecía Calcular Nómina): un solo lugar
          para pagar quincenas. */}
      <div className="erp-tabs-pill">
        {([
          { key: "employees" as const, label: "Empleados", icon: Users },
          { key: "payroll" as const, label: "Calcular Nómina", icon: Calculator },
          { key: "cuts" as const, label: "Cortes Quincenales", icon: CalendarClock },
          { key: "attendance" as const, label: "Asistencia", icon: CalendarX2 },
          { key: "loans" as const, label: "Préstamos", icon: DollarSign },
          { key: "history" as const, label: "Historial", icon: History },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={tab === t.key ? "active" : ""}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* Tabs heredados: se reutiliza EmployeeManager con tab fijo hasta extraerlos. */}
      {(tab === "payroll" || tab === "loans" || tab === "history") && (
        <EmployeeManager forcedTab={tab} hideTabBar hideKpis onGoToCuts={() => setTab("cuts")} />
      )}

      {/* Corte consolidado: el ÚNICO flujo para pagar quincenas. */}
      {tab === "cuts" && <BiweeklyCutsPanel />}

      {/* Asistencia: faltas injustificadas = día de pago menos (÷30). */}
      {tab === "attendance" && <AttendancePanel />}

      {tab === "employees" && (
        <>
          {/* ── 5 · Toolbar ── */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-[var(--color-text-secondary)] whitespace-nowrap" htmlFor="payroll-branch-filter">
              Sucursal:
            </label>
            <select
              id="payroll-branch-filter"
              value={selectedBranch}
              onChange={(e) => {
                const branchId = e.target.value;
                setSelectedBranch(branchId);
                // La selección unitaria se limpia si el empleado no pertenece
                // a la nueva sucursal.
                if (branchId && selectedEmployee && !employees.some((emp) => emp.id === selectedEmployee && emp.branchId === branchId)) {
                  setSelectedEmployee("");
                }
              }}
              className="hm-input rounded-lg text-sm"
            >
              <option value="">Todas ({employees.length})</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name} ({employees.filter((e) => e.branchId === b.id).length})
                </option>
              ))}
            </select>

            {/* Selección unitaria: el hero, la tabla y el CSV pasan a mostrar
                el desglose de UN solo trabajador. */}
            <label className="text-sm font-medium text-[var(--color-text-secondary)] whitespace-nowrap" htmlFor="payroll-employee-filter">
              Empleado:
            </label>
            <select
              id="payroll-employee-filter"
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
              className="hm-input max-w-[220px] rounded-lg text-sm"
            >
              <option value="">Todos</option>
              {employees
                .filter((e) => !selectedBranch || e.branchId === selectedBranch)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName}
                    {e.isActive ? "" : " (inactivo)"}
                  </option>
                ))}
            </select>

            <div className="relative max-w-[300px] flex-1 basis-[210px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-soft)]" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar nombre o puesto"
                aria-label="Buscar empleado"
                className="hm-input w-full rounded-lg pl-9 text-sm"
              />
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-[5px] border border-[var(--color-border-strong)] px-1.5 text-[0.625rem] font-semibold text-[var(--color-text-soft)]">
                /
              </kbd>
            </div>

            {/* Prestaciones: la obligación legal existe en ambos modos — el
                control solo cambia CUÁNDO se refleja en el costo (nada de
                "apagar" aguinaldo/vacaciones/indemnización). */}
            <fieldset
              className="inline-flex select-none items-center gap-2 whitespace-nowrap text-[0.78rem] text-[var(--color-text-muted)]"
              title="Aguinaldo, vacaciones e indemnización son obligaciones de ley en ambos modos; solo cambia cuándo se reflejan en el costo: provisionadas mes a mes o reconocidas al pagarlas."
            >
              <legend className="sr-only">Modo de reconocimiento de prestaciones sociales</legend>
              <span className="font-medium">Prestaciones:</span>
              {([
                { value: true, label: "Provisionar mensual" },
                { value: false, label: "Reconocer al pago" },
              ] as const).map((opt) => (
                <label key={opt.label} className="inline-flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="benefits-mode"
                    checked={includeProvisions === opt.value}
                    onChange={() => {
                      provisionsTouched.current = true;
                      setIncludeProvisions(opt.value);
                    }}
                    className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-info-600)]"
                  />
                  {opt.label}
                </label>
              ))}
            </fieldset>

            <button
              onClick={exportCsv}
              className="ml-auto flex items-center gap-2 rounded-lg border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--color-text-secondary)] shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-alt)]"
            >
              <Download className="h-3.5 w-3.5" /> Exportar CSV
            </button>
          </div>

          {/* ── 6 · Tabla ── */}
          <div className="hm-module-card">
            {showForm && (
              <div className="space-y-3 border-b border-[var(--color-border)] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{editingId ? "Editar Empleado" : "Nuevo Empleado"}</p>
                  <button onClick={() => { setShowForm(false); setEditingId(null); }} className="hm-icon-btn"><X className="h-4 w-4" /></button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="grid gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                    Nombre completo *
                    <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case" placeholder="Juan Perez" />
                  </label>
                  <label className="grid gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                    Puesto *
                    <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case">
                      {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                    Sucursal *
                    <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case">
                      <option value="">Seleccionar...</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                    Salario mensual (C$) *
                    <input type="number" step="0.01" min="0.01" value={form.monthlySalary} onChange={(e) => setForm({ ...form, monthlySalary: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case" placeholder="10000" />
                  </label>
                  <label className="grid gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                    Fecha de inicio *
                    <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case" />
                  </label>
                  <label className="grid gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]" title="El salario con el que está registrado en el INSS puede ser distinto al real. INSS e INATEC se calculan sobre esta base (así cuadran con la factura). Vacío = usar el salario real.">
                    Salario INSS (cotizable)
                    <input type="number" step="0.01" min="0.01" value={form.inssSalary} onChange={(e) => setForm({ ...form, inssSalary: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case" placeholder="Ej: 6519.58 (vacío = salario real)" />
                  </label>
                  <label className="grid gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                    Número de cédula
                    <input value={form.nationalId} maxLength={20} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case" placeholder="Ej: 401-123456-0001A" />
                  </label>
                  {/* Varía por trabajador: quien tributa por su cuenta NO lleva
                      retención de IR (default). Se marca solo si a esta persona
                      sí se le retiene en nómina. */}
                  <label className="flex cursor-pointer select-none items-center gap-2 self-end pb-2 text-[0.78rem] font-normal normal-case tracking-normal text-[var(--color-text-secondary)]" title="El IR salarial (Ley 822) se retiene solo a los trabajadores que no tributan por su cuenta. Al resto, únicamente se le deduce INSS y préstamos.">
                    <input
                      type="checkbox"
                      checked={form.applyIrRetention}
                      onChange={(e) => setForm({ ...form, applyIrRetention: e.target.checked })}
                      className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-info-600)]"
                    />
                    Retener IR en nómina (varía por trabajador)
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => void handleSubmitForm()} disabled={loading} className="flex items-center gap-2 rounded-lg bg-[var(--color-info-600)] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-info-700)] disabled:opacity-50">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {editingId ? "Guardar cambios" : "Crear empleado"}
                  </button>
                  <button onClick={() => { setShowForm(false); setEditingId(null); }} className="rounded-lg px-4 py-2 text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-alt)]">Cancelar</button>
                </div>
              </div>
            )}

            {loading && employees.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--color-info-500)]" />
              </div>
            ) : visibleEmployees.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-[var(--color-text-soft)]">
                <h3 className="mb-1 text-[0.9375rem] font-semibold text-[var(--color-text-secondary)]">Sin resultados</h3>
                <p>Ningún empleado coincide con la búsqueda o el filtro de sucursal.</p>
                <button
                  onClick={clearFilters}
                  className="mt-4 rounded-lg border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)]"
                >
                  Limpiar filtros
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="hm-table w-full">
                  <thead>
                    <tr>
                      <th className="cursor-pointer select-none text-left" onClick={() => toggleSort("name")}>
                        Empleado <span className="text-[0.55rem] text-[var(--color-master-500)]">{sortArrow("name")}</span>
                      </th>
                      <th className="text-left">Sucursal</th>
                      <th className="cursor-pointer select-none text-right" onClick={() => toggleSort("salary")}>
                        Salario <span className="text-[0.55rem] text-[var(--color-master-500)]">{sortArrow("salary")}</span>
                      </th>
                      <th className="hidden text-right md:table-cell">% Nómina</th>
                      <th className="cursor-pointer select-none text-left" onClick={() => toggleSort("start")}>
                        Inicio <span className="text-[0.55rem] text-[var(--color-master-500)]">{sortArrow("start")}</span>
                      </th>
                      <th className="text-right">
                        Neto a pagar
                        {anyEstimated && <span className="hm-badge hm-badge-warning ml-1.5 align-middle text-[0.5rem]">Estimado</span>}
                      </th>
                      <th className="hidden text-right md:table-cell">
                        Costo empresa
                        {anyEstimated && <span className="hm-badge hm-badge-warning ml-1.5 align-middle text-[0.5rem]">Estimado</span>}
                      </th>
                      <th className="text-left">Estado</th>
                      <th className="text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => {
                      const groupRows: React.ReactNode[] = [];
                      if (group.branch) {
                        const accent = branchAccent(group.branch.id);
                        const sub = group.items.reduce(
                          (acc, emp) => {
                            const { b } = breakdownOf(emp);
                            acc.base += Number(emp.monthlySalary);
                            acc.cost += employerCostOf(b);
                            return acc;
                          },
                          { base: 0, cost: 0 },
                        );
                        groupRows.push(
                          <tr key={`grp-${group.branch.id}`}>
                            <td colSpan={2} className="!bg-[var(--color-surface-muted)] !py-2 text-[0.6563rem] font-bold uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
                              <span className="inline-flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full" style={{ background: `var(--color-${accent}-400)` }} />
                                {group.branch.code} — {group.branch.name} · {group.items.length}
                              </span>
                            </td>
                            <td className="!bg-[var(--color-surface-muted)] !py-2 text-right font-mono text-[0.6875rem] font-semibold text-[var(--color-text-muted)]">{fmtC(sub.base)}</td>
                            <td className="hidden !bg-[var(--color-surface-muted)] !py-2 md:table-cell" />
                            <td className="!bg-[var(--color-surface-muted)] !py-2" />
                            <td className="!bg-[var(--color-surface-muted)] !py-2" />
                            <td className="hidden !bg-[var(--color-surface-muted)] !py-2 text-right font-mono text-[0.6875rem] font-semibold text-[var(--color-text-muted)] md:table-cell">{fmtC(sub.cost)}</td>
                            <td colSpan={2} className="!bg-[var(--color-surface-muted)] !py-2" />
                          </tr>,
                        );
                      }
                      for (const emp of group.items) {
                        const { b, estimated } = breakdownOf(emp);
                        const salary = Number(emp.monthlySalary);
                        const share = emp.isActive && activeBaseTotal > 0 ? (salary / activeBaseTotal) * 100 : 0;
                        const accent = branchAccent(emp.branchId);
                        const avatarAccent = AVATAR_ACCENTS[hashIndex(emp.id, AVATAR_ACCENTS.length)];
                        const isConfirming = confirmDeactivateId === emp.id;
                        const delay = rowDelay;
                        rowDelay += 40;
                        groupRows.push(
                          <tr
                            key={emp.id}
                            className="pay-row cursor-pointer"
                            style={{ animationDelay: `${delay}ms` }}
                            tabIndex={0}
                            role="button"
                            aria-label={`Ver desglose de ${emp.fullName}`}
                            onClick={() => setDrawerEmployeeId(emp.id)}
                            onKeyDown={(e) => { if (e.key === "Enter") setDrawerEmployeeId(emp.id); }}
                          >
                            <td>
                              <div className="flex items-center gap-2.5">
                                <div
                                  className="hm-avatar h-8 w-8 text-[0.6875rem]"
                                  style={{ background: `var(--color-${avatarAccent}-100)`, color: `var(--color-${avatarAccent}-700)` }}
                                >
                                  {initials(emp.fullName)}
                                </div>
                                <div>
                                  <div className="text-[0.8438rem] font-semibold leading-tight text-[var(--color-text)]">{emp.fullName}</div>
                                  <div className="flex items-center gap-1 text-[0.7188rem] text-[var(--color-text-soft)]">
                                    <Briefcase className="h-2.5 w-2.5" /> {emp.position}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] px-2.5 py-0.5 text-[0.6875rem] font-semibold text-[var(--color-text-secondary)]">
                                <span className="h-[7px] w-[7px] rounded-full" style={{ background: `var(--color-${accent}-400)` }} />
                                {emp.branch?.code ?? "—"}
                              </span>
                            </td>
                            <td className="text-right font-mono font-medium text-[var(--color-text)]">
                              {fmtC(salary)}
                              {b.belowMinimumWage && (
                                <span
                                  className="hm-badge hm-badge-warning ml-1.5 align-middle text-[0.5rem]"
                                  title={`Por debajo del salario mínimo sectorial configurado (${fmtC(rates.salarioMinimoSectorial)})`}
                                >
                                  &lt; mínimo
                                </span>
                              )}
                            </td>
                            <td className="hidden text-right md:table-cell">
                              <div className="flex items-center justify-end gap-2">
                                <span className="w-9 text-right text-[0.7188rem] tabular-nums text-[var(--color-text-muted)]">{share.toFixed(0)}%</span>
                                <span className="h-[5px] w-14 overflow-hidden rounded-full border border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                                  <span
                                    className="block h-full rounded-full"
                                    style={{ width: `${Math.min(100, share)}%`, background: "linear-gradient(90deg, var(--color-master-400), var(--color-master-600))" }}
                                  />
                                </span>
                              </div>
                            </td>
                            <td className="text-[var(--color-text-muted)]">{fmtDateShort(emp.startDate)}</td>
                            <td className="text-right font-mono font-semibold text-[var(--color-success-600)]">
                              {fmtC(b.netPay)}
                              {estimated && <span className="hm-badge hm-badge-warning ml-1.5 align-middle text-[0.5rem]">EST</span>}
                            </td>
                            <td className="hidden text-right font-mono text-[var(--color-text-muted)] md:table-cell">
                              {fmtC(employerCostOf(b))}
                              {/* Tasa de indemnización visible cuando el tramo Art. 45 ya
                                  no es el inicial: explica por qué dos empleados con igual
                                  salario cuestan distinto. */}
                              {includeProvisions && (b.indemnizacionRateActual ?? 1 / 12) !== 1 / 12 && (
                                <span
                                  className="block text-[0.625rem] font-sans text-[var(--color-owner-600)]"
                                  title={
                                    (b.indemnizacionRateActual ?? 0) === 0
                                      ? "Indemnización Art. 45: tope de 5 meses alcanzado (6+ años) — ya no se provisiona."
                                      : "Indemnización Art. 45: tramo años 4–6 (20 días/año) — provisión (20/30)/12."
                                  }
                                >
                                  {(b.indemnizacionRateActual ?? 0) === 0
                                    ? "indemn. 0% (tope)"
                                    : `indemn. ${fmtRatePct3(b.indemnizacionRateActual ?? 0)}`}
                                </span>
                              )}
                            </td>
                            <td>
                              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[0.5625rem] font-semibold ${
                                emp.isActive
                                  ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]"
                                  : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"
                              }`}>{emp.isActive ? "Activo" : "Inactivo"}</span>
                            </td>
                            <td className="text-right">
                              {isConfirming ? (
                                <div className="flex flex-wrap items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                  <span className="text-xs text-[var(--color-danger-700)]">¿Desactivar?</span>
                                  <button onClick={() => { void handleDeactivate(emp.id); setConfirmDeactivateId(null); }} disabled={loading} className="rounded bg-[var(--color-danger-600)] px-2 py-1 text-xs text-white disabled:opacity-50">Sí</button>
                                  <button onClick={() => setConfirmDeactivateId(null)} className="rounded px-2 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">No</button>
                                </div>
                              ) : (
                                <div className="flex justify-end gap-1">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); openEditForm(emp); }}
                                    className="hm-icon-btn text-[var(--color-info-600)]"
                                    title="Editar"
                                    aria-label={`Editar a ${emp.fullName}`}
                                  >
                                    <Edit2 className="h-4 w-4" />
                                  </button>
                                  {emp.isActive && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setConfirmDeactivateId(emp.id); }}
                                      disabled={loading}
                                      className="hm-icon-btn text-[var(--color-danger-600)] disabled:opacity-50"
                                      title="Desactivar"
                                      aria-label={`Desactivar a ${emp.fullName}`}
                                    >
                                      <UserMinus className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>,
                        );
                      }
                      return groupRows;
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2} className="border-t-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] px-3.5 py-3 text-[0.8125rem] font-bold text-[var(--color-text)]">
                        Total · {visibleEmployees.length} empleado{visibleEmployees.length !== 1 ? "s" : ""}
                      </td>
                      <td className="border-t-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] px-3.5 py-3 text-right font-mono text-[0.8125rem] font-bold text-[var(--color-text)]">{fmtC(visibleTotals.base)}</td>
                      <td className="hidden border-t-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] md:table-cell" />
                      <td className="border-t-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-surface-alt)]" />
                      <td className="border-t-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] px-3.5 py-3 text-right font-mono text-[0.8125rem] font-bold text-[var(--color-success-600)]">{fmtC(visibleTotals.net)}</td>
                      <td className="hidden border-t-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] px-3.5 py-3 text-right font-mono text-[0.8125rem] font-bold text-[var(--color-warning-600)] md:table-cell">{fmtC(visibleTotals.cost)}</td>
                      <td colSpan={2} className="border-t-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-surface-alt)]" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── 7 · Drawer de detalle (compartido con RRHH) ── */}
      <EmployeeProfileDrawer
        employee={drawerEmployee}
        rates={rates}
        includeProvisions={includeProvisions}
        onClose={() => setDrawerEmployeeId(null)}
        onChanged={loadEmployees}
        onGoToPayroll={() => { setDrawerEmployeeId(null); setTab("payroll"); }}
      />
    </div>
  );
}
