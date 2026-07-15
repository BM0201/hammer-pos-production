"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  Briefcase,
  Calculator,
  CalendarClock,
  CalendarDays,
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
import { PayrollCostHero, type PayrollHeroTotals } from "./payroll-cost-hero";
import { PayrollCompositionBar, type PayrollSegmentAmounts } from "./payroll-composition-bar";
import {
  DEFAULT_PAYROLL_RATES,
  MES_LARGO,
  computeMonthlyBreakdown,
  fmtC,
  fmtDateShort,
  fmtRatePct,
  fmtRatePct3,
  fmtSeniority,
  initials,
  nextBiweeklyPayday,
  resolveInssRates,
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
  branch: { id: string; code: string; name: string };
  payrollEstimate?: PayrollBreakdown | null;
  payrollRates?: PayrollRates;
};

type PanelTab = "employees" | "payroll" | "cuts" | "loans" | "history";
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

  const [bannerDismissed, setBannerDismissed] = useState(true);
  const [drawerEmployeeId, setDrawerEmployeeId] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: "", position: "Vendedor", branchId: "", monthlySalary: "", startDate: "", applyIrRetention: false });

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

  // Tasas INSS resueltas por régimen + conteo global (las tasas ya no viajan
  // sueltas en la config: se derivan, y cambian solas al cruzar 50 activos).
  const inssResolved = useMemo(() => resolveInssRates(rates.inssRegime, rates.activeEmployeeCount), [rates]);

  // Desglose por empleado: backend si existe; espejo cliente como fallback
  // (startDate define el tramo de indemnización y las prestaciones acumuladas).
  const breakdownOf = useCallback(
    (emp: EmployeeRow): { b: PayrollBreakdown; estimated: boolean } => {
      if (emp.payrollEstimate) return { b: emp.payrollEstimate, estimated: false };
      return { b: computeMonthlyBreakdown(Number(emp.monthlySalary), rates, emp.startDate, emp.applyIrRetention ?? false), estimated: true };
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
        body: JSON.stringify({ ...form, monthlySalary: salaryNum }),
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
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-success-100)] bg-[var(--color-success-50)] px-3 py-0.5 text-xs font-semibold text-[var(--color-success-700)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success-500)]" />
            Próximo pago: {payday.label}
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
            <Link href={"/app/master/users" as Route} className="font-semibold underline">Personal &amp; Roles</Link>.
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

      {/* ── 4 · Tabs (mismos del sistema) ──
          "Cortes Quincenales" vive AQUÍ (antes era un tab aparte en Finanzas y
          duplicaba el pago que también ofrecía Calcular Nómina): un solo lugar
          para pagar quincenas. */}
      <div className="erp-tabs-pill">
        {([
          { key: "employees" as const, label: "Empleados", icon: Users },
          { key: "payroll" as const, label: "Calcular Nómina", icon: Calculator },
          { key: "cuts" as const, label: "Cortes Quincenales", icon: CalendarClock },
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

      {/* ── 7 · Drawer de detalle ── */}
      <div
        className={`fixed inset-0 z-40 bg-[rgb(28_25_23/0.45)] transition-opacity duration-200 ${drawerEmployee ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setDrawerEmployeeId(null)}
        aria-hidden="true"
      />
      <aside
        className={`fixed bottom-0 right-0 top-0 z-50 flex w-[min(430px,100vw)] flex-col border-l border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-modal)] transition-transform duration-300 motion-reduce:transition-none ${drawerEmployee ? "translate-x-0" : "translate-x-full"}`}
        style={{ transitionTimingFunction: "var(--ease-drawer)" }}
        role="dialog"
        aria-modal="true"
        aria-label={drawerEmployee ? `Desglose de ${drawerEmployee.fullName}` : "Detalle de empleado"}
      >
        {drawerEmployee && (() => {
          const { b, estimated } = breakdownOf(drawerEmployee);
          const cost = employerCostOf(b);
          const amounts: PayrollSegmentAmounts = {
            neto: b.netPay,
            ret: round2(b.inssLaboral + b.ir),
            patronal: b.inssPatronal,
            inatec: b.inatec,
            agui: includeProvisions ? b.aguinaldoAccrual : 0,
            vac: includeProvisions ? b.vacacionesAccrual : 0,
            indem: includeProvisions ? b.indemnizacionAccrual : 0,
          };
          const months = b.monthsOfService ?? 0;
          const indemRate = b.indemnizacionRateActual ?? 1 / 12;
          const vacBalance = b.vacationDaysBalance ?? 0;
          const chipExento = (
            <span className="ml-1.5 inline-flex rounded-full border border-[var(--color-success-100)] bg-[var(--color-success-50)] px-1.5 py-px align-middle text-[0.5313rem] font-bold uppercase tracking-wide text-[var(--color-success-700)]">
              Exento IR/INSS
            </span>
          );
          const chipGravable = (
            <span className="ml-1.5 inline-flex rounded-full border border-[var(--color-warning-100)] bg-[var(--color-warning-50)] px-1.5 py-px align-middle text-[0.5313rem] font-bold uppercase tracking-wide text-[var(--color-warning-700)]">
              Gravable si se paga
            </span>
          );
          const avatarAccent = AVATAR_ACCENTS[hashIndex(drawerEmployee.id, AVATAR_ACCENTS.length)];
          const branch = drawerEmployee.branch;
          const sw = (k: keyof PayrollSegmentAmounts) => (
            <span className="h-2 w-2 rounded-[3px]" style={{ background: `var(--pay-seg-${k})` }} />
          );
          const dline = "flex items-baseline justify-between py-1.5 text-[0.8438rem]";
          return (
            <>
              <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 pb-4 pt-5">
                <div
                  className="hm-avatar h-11 w-11 text-[0.9375rem]"
                  style={{ background: `var(--color-${avatarAccent}-100)`, color: `var(--color-${avatarAccent}-700)` }}
                >
                  {initials(drawerEmployee.fullName)}
                </div>
                <div>
                  <h2 className="text-[1.0625rem] font-bold tracking-tight text-[var(--color-text)]">{drawerEmployee.fullName}</h2>
                  <p className="text-[0.78rem] text-[var(--color-text-soft)]">
                    {drawerEmployee.position} · {branch?.code} — {branch?.name} · desde {fmtDateShort(drawerEmployee.startDate)}
                    {drawerEmployee.endDate ? ` · fin ${fmtDateShort(drawerEmployee.endDate)}` : ""}
                  </p>
                </div>
                <button onClick={() => setDrawerEmployeeId(null)} aria-label="Cerrar detalle" className="hm-icon-btn ml-auto">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-5">
                <section className="mb-6">
                  <h4 className="mb-2.5 flex items-center gap-2 text-[0.6875rem] font-bold uppercase tracking-[0.07em] text-[var(--color-text-soft)] after:h-px after:flex-1 after:bg-[var(--color-border)]">
                    ¿A dónde va cada córdoba?
                    {estimated && <span className="hm-badge hm-badge-warning text-[0.5rem] normal-case tracking-normal">Estimado</span>}
                  </h4>
                  <PayrollCompositionBar amounts={amounts} total={cost} rates={rates} mini />

                  {/* Bloque 1: el salario del trabajador (lo único que se le
                      puede deducir es INSS + IR de ley y préstamos). */}
                  <p className="mb-0.5 mt-3 text-[0.625rem] font-bold uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
                    Del salario del trabajador
                  </p>
                  <div className={dline}><span className="flex items-center gap-2 text-[var(--color-text-secondary)]">{sw("neto")}Neto al empleado</span><span className="font-mono tabular-nums text-[var(--color-success-600)]">{fmtC(b.netPay)}</span></div>
                  <div className={dline}><span className="flex items-center gap-2 text-[var(--color-text-secondary)]">{sw("ret")}Retenciones <small className="text-[0.6875rem] text-[var(--color-text-soft)]">INSS {fmtRatePct(inssResolved.laboral)}{b.ir > 0 ? " + IR de ley" : " (sin retención de IR)"}</small></span><span className="font-mono tabular-nums text-[var(--color-text)]">{fmtC(amounts.ret)}</span></div>

                  {/* Bloque 2: aportes que la EMPRESA paga aparte — nunca se
                      deducen del salario del trabajador. */}
                  <p className="mb-0.5 mt-3 text-[0.625rem] font-bold uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
                    El patrón paga aparte (no se deduce al trabajador)
                  </p>
                  <div className={dline}><span className="flex items-center gap-2 text-[var(--color-text-secondary)]">{sw("patronal")}INSS patronal <small className="text-[0.6875rem] text-[var(--color-text-soft)]">{fmtRatePct(inssResolved.patronal)}</small></span><span className="font-mono tabular-nums text-[var(--color-text)]">{fmtC(b.inssPatronal)}</span></div>
                  <div className={dline}><span className="flex items-center gap-2 text-[var(--color-text-secondary)]">{sw("inatec")}INATEC <small className="text-[0.6875rem] text-[var(--color-text-soft)]">{fmtRatePct(rates.inatecRate)} · lo paga la empresa</small></span><span className="font-mono tabular-nums text-[var(--color-text)]">{fmtC(b.inatec)}</span></div>
                  {includeProvisions && (
                    <>
                      <div className={dline}><span className="flex items-center gap-2 text-[var(--color-text-secondary)]">{sw("agui")}Aguinaldo <small className="text-[0.6875rem] text-[var(--color-text-soft)]">1/12</small></span><span className="font-mono tabular-nums text-[var(--color-text)]">{fmtC(b.aguinaldoAccrual)}</span></div>
                      <div className={dline}><span className="flex items-center gap-2 text-[var(--color-text-secondary)]">{sw("vac")}Vacaciones <small className="text-[0.6875rem] text-[var(--color-text-soft)]">2.5 días/mes</small></span><span className="font-mono tabular-nums text-[var(--color-text)]">{fmtC(b.vacacionesAccrual)}</span></div>
                      <div className={dline}><span className="flex items-center gap-2 text-[var(--color-text-secondary)]">{sw("indem")}Indemnización <small className="text-[0.6875rem] text-[var(--color-text-soft)]">Art. 45 · {indemRate === 0 ? "tope" : fmtRatePct3(indemRate)}</small></span><span className="font-mono tabular-nums text-[var(--color-text)]">{fmtC(b.indemnizacionAccrual)}</span></div>
                    </>
                  )}
                  <div className="flex items-baseline justify-between border-t border-[var(--color-border)] pt-1.5 text-[0.8125rem] font-semibold">
                    <span className="text-[var(--color-text-secondary)]">Subtotal aportes del patrón</span>
                    <span className="font-mono tabular-nums text-[var(--color-text)]">{fmtC(round2(b.inssPatronal + b.inatec + (includeProvisions ? b.provisions : 0)))}</span>
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between border-t border-[var(--color-border-strong)] pt-2.5 text-sm font-bold">
                    <span className="text-[var(--color-text-secondary)]">Costo mensual empresa</span>
                    <span className="font-mono tabular-nums text-[var(--color-warning-600)]">{fmtC(cost)}</span>
                  </div>
                </section>

                <section className="mb-6">
                  <h4 className="mb-2.5 flex items-center gap-2 text-[0.6875rem] font-bold uppercase tracking-[0.07em] text-[var(--color-text-soft)] after:h-px after:flex-1 after:bg-[var(--color-border)]">
                    Recibo del empleado
                  </h4>
                  <div className={dline}><span className="text-[var(--color-text-secondary)]">Salario base</span><span className="font-mono tabular-nums text-[var(--color-text)]">{fmtC(Number(drawerEmployee.monthlySalary))}</span></div>
                  <div className={dline}><span className="text-[var(--color-text-secondary)]">INSS laboral <small className="text-[0.6875rem] text-[var(--color-text-soft)]">{fmtRatePct(inssResolved.laboral)} · se retiene y entera 1 vez al mes</small></span><span className="font-mono tabular-nums text-[var(--color-danger-600)]">− {fmtC(b.inssLaboral)}</span></div>
                  {b.ir > 0 && (
                    <div className={dline}><span className="text-[var(--color-text-secondary)]">IR <small className="text-[0.6875rem] text-[var(--color-text-soft)]">retención de ley (Ley 822) al superar C$100,000/año</small></span><span className="font-mono tabular-nums text-[var(--color-danger-600)]">− {fmtC(b.ir)}</span></div>
                  )}
                  <div className="mt-1.5 flex items-baseline justify-between border-t border-[var(--color-border-strong)] pt-2.5 text-sm font-bold">
                    <span className="text-[var(--color-text-secondary)]">Neto a pagar</span>
                    <span className="font-mono tabular-nums text-[var(--color-success-600)]">{fmtC(b.netPay)}</span>
                  </div>
                  <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-[var(--color-text-soft)]">
                    Al trabajador SOLO se le deduce el INSS laboral{b.ir > 0 ? ", el IR de ley" : ""} y las cuotas de
                    préstamos que tenga activos. El INSS patronal, el INATEC y las prestaciones sociales las paga la
                    empresa aparte: nunca salen de su salario.
                  </p>
                </section>

                {/* Prestaciones ACUMULADAS: pasivo por empleado según ley (no es
                    el costo del mes — es lo que la empresa ya debe a la fecha). */}
                <section className="mb-6">
                  <h4 className="mb-2.5 flex items-center gap-2 text-[0.6875rem] font-bold uppercase tracking-[0.07em] text-[var(--color-text-soft)] after:h-px after:flex-1 after:bg-[var(--color-border)]">
                    Prestaciones acumuladas
                  </h4>
                  <div className={dline}>
                    <span className="text-[var(--color-text-secondary)]">Antigüedad</span>
                    <span className="font-mono tabular-nums text-[var(--color-text)]">{fmtSeniority(months)}</span>
                  </div>
                  <div className={dline}>
                    <span className="text-[var(--color-text-secondary)]">
                      Aguinaldo del período <small className="text-[0.6875rem] text-[var(--color-text-soft)]">dic–nov · pagar antes del {b.aguinaldoDeadline ? fmtDateShort(b.aguinaldoDeadline) : "10 dic"}</small>
                      {chipExento}
                    </span>
                    <span className="font-mono tabular-nums text-[var(--color-text)]">{fmtC(b.aguinaldoAccrued ?? 0)}</span>
                  </div>
                  <div className={dline}>
                    <span className="text-[var(--color-text-secondary)]">
                      Vacaciones <small className="text-[0.6875rem] text-[var(--color-text-soft)]">{vacBalance.toLocaleString("es-NI", { maximumFractionDigits: 1 })} días de saldo</small>
                      {chipGravable}
                    </span>
                    <span className="font-mono tabular-nums text-[var(--color-text)]">{fmtC(b.vacationBalanceValue ?? 0)}</span>
                  </div>
                  <div className={dline}>
                    <span className="text-[var(--color-text-secondary)]">
                      Indemnización Art. 45{" "}
                      <small className="text-[0.6875rem] text-[var(--color-text-soft)]">
                        {indemRate === 0 ? "tope de 5 meses alcanzado" : `tramo actual ${fmtRatePct3(indemRate)}`}
                      </small>
                      {chipExento}
                    </span>
                    <span className="font-mono tabular-nums text-[var(--color-text)]">{fmtC(b.indemnizacionAccrued ?? 0)}</span>
                  </div>
                  <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-[var(--color-text-soft)]">
                    La indemnización acumula 1 mes/año (años 1–3) y 20 días/año (años 4–6), con tope de 5 meses de
                    salario; exenta de IR hasta 5 meses + C$500,000 (Ley 822). El aguinaldo es exento de todo (Art. 97 CT);
                    las vacaciones pagadas en dinero gravan INSS e IR el mes en que se pagan.
                  </p>
                </section>
              </div>

              <div className="flex gap-2.5 border-t border-[var(--color-border)] px-5 py-4">
                <Link
                  href={"/app/master/users" as Route}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)]"
                >
                  Editar ficha
                </Link>
                <button
                  onClick={() => { setDrawerEmployeeId(null); setTab("payroll"); }}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--color-info-600)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-info-700)]"
                >
                  <Calculator className="h-4 w-4" /> Calcular nómina
                </button>
              </div>
            </>
          );
        })()}
      </aside>
    </div>
  );
}
