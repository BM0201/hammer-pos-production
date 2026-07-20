"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Calculator, X } from "lucide-react";
import toast from "react-hot-toast";
import { apiFetch } from "@/lib/client/api";
import {
  computeMonthlyBreakdown,
  fmtC,
  fmtDateShort,
  fmtRatePct,
  fmtRatePct3,
  fmtSeniority,
  indemnizacionPayout,
  initials,
  resolveInssRates,
  round2,
  SEVERANCE_CAUSALES,
  type PayrollBreakdown,
  type PayrollRates,
  type SeveranceCausal,
} from "@/components/finance/payroll-calc";
import { PayrollCompositionBar, type PayrollSegmentAmounts } from "@/components/finance/payroll-composition-bar";

/**
 * Perfil del trabajador — compartido entre RRHH y Finanzas
 * › Planilla: cédula, asistencia, prestaciones acumuladas y liquidación.
 *
 * Liquidación en dos modalidades (evita que la indemnización acumule sin
 * límite — "bola de nieve" — si el trabajador nunca se liquida):
 *  - ROLLOVER: liquidación y recontratación INMEDIATA. Sigue activo, se paga
 *    lo acumulado y se resetea el reloj de antigüedad.
 *  - TERMINATION: baja definitiva. Requiere causal (Arts. 45/48 CT), que
 *    decide si la indemnización aplica.
 */

export type DrawerEmployee = {
  id: string;
  fullName: string;
  position: string;
  branchId: string;
  monthlySalary: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  applyIrRetention?: boolean;
  inssSalary?: string | null;
  nationalId?: string | null;
  lastLiquidationAt?: string | null;
  branch: { id: string; code: string; name: string };
  payrollEstimate?: PayrollBreakdown | null;
  payrollRates?: PayrollRates;
};

type Props = {
  employee: DrawerEmployee | null;
  rates: PayrollRates;
  includeProvisions?: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  editHref?: string;
  /** Si se provee, reemplaza el link "Editar ficha" por una acción en la misma vista. */
  onEdit?: () => void;
  onGoToPayroll?: () => void;
};

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

export function EmployeeProfileDrawer({ employee, rates, includeProvisions = true, onClose, onChanged, editHref, onEdit, onGoToPayroll }: Props) {
  const [vacationFormOpen, setVacationFormOpen] = useState(false);
  const [vacationForm, setVacationForm] = useState({ date: new Date().toISOString().slice(0, 10), days: "", kind: "GOZADAS" as "GOZADAS" | "PAGADAS" });
  const [vacationSaving, setVacationSaving] = useState(false);

  const [liquidationOpen, setLiquidationOpen] = useState(false);
  const [settlementKind, setSettlementKind] = useState<"ROLLOVER" | "TERMINATION">("ROLLOVER");
  const [severanceCausal, setSeveranceCausal] = useState<SeveranceCausal>("DESPIDO_SIN_CAUSA");
  const [confirmLiquidation, setConfirmLiquidation] = useState(false);
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    setVacationFormOpen(false);
    setVacationForm({ date: new Date().toISOString().slice(0, 10), days: "", kind: "GOZADAS" });
    setLiquidationOpen(false);
    setSettlementKind("ROLLOVER");
    setSeveranceCausal("DESPIDO_SIN_CAUSA");
    setConfirmLiquidation(false);
  }, [employee?.id]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submitVacationEntry(employeeId: string) {
    const days = Number(vacationForm.days);
    if (!vacationForm.days || Number.isNaN(days) || days <= 0) {
      toast.error("Ingresa un número de días mayor a 0");
      return;
    }
    setVacationSaving(true);
    try {
      const r = await apiFetch("/api/payroll/vacation-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, date: vacationForm.date, days, kind: vacationForm.kind }),
      });
      if (!r.ok) {
        toast.error(getErrorMessage(await r.json(), "No se pudo registrar"));
        return;
      }
      toast.success(vacationForm.kind === "GOZADAS" ? "Vacaciones gozadas registradas" : "Vacaciones pagadas registradas");
      setVacationFormOpen(false);
      setVacationForm({ date: new Date().toISOString().slice(0, 10), days: "", kind: "GOZADAS" });
      await onChanged();
    } catch {
      toast.error("Error de conexión");
    } finally {
      setVacationSaving(false);
    }
  }

  async function submitSettlement() {
    if (!employee) return;
    setSettling(true);
    try {
      const body: Record<string, unknown> = { employeeId: employee.id, kind: settlementKind };
      if (settlementKind === "TERMINATION") body.causal = severanceCausal;
      const r = await apiFetch("/api/payroll/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        toast.error(getErrorMessage(await r.json(), "No se pudo liquidar"));
        return;
      }
      toast.success(settlementKind === "ROLLOVER" ? "Liquidación y recontratación registrada" : "Trabajador liquidado y dado de baja");
      setLiquidationOpen(false);
      setConfirmLiquidation(false);
      await onChanged();
      if (settlementKind === "TERMINATION") onClose();
    } catch {
      toast.error("Error de conexión");
    } finally {
      setSettling(false);
    }
  }

  if (!employee) return null;

  const inssResolved = resolveInssRates(rates.inssRegime, rates.activeEmployeeCount);
  // Ancla de antigüedad: si ya se liquidó-y-recontrató, todo se cuenta desde
  // ahí — evita que la indemnización acumule sin límite.
  const anchor = employee.lastLiquidationAt ?? employee.startDate;
  const estimated = !employee.payrollEstimate;
  const b: PayrollBreakdown = employee.payrollEstimate ?? computeMonthlyBreakdown(
    Number(employee.monthlySalary),
    rates,
    anchor,
    employee.applyIrRetention ?? false,
    employee.inssSalary != null ? Number(employee.inssSalary) : undefined,
  );
  const cost = round2(b.employerCost - (includeProvisions ? 0 : b.provisions));
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
  const avatarAccent = AVATAR_ACCENTS[hashIndex(employee.id, AVATAR_ACCENTS.length)];
  const branch = employee.branch;
  const sw = (k: keyof PayrollSegmentAmounts) => <span className="h-2 w-2 rounded-[3px]" style={{ background: `var(--pay-seg-${k})` }} />;
  const dline = "flex items-baseline justify-between py-1.5 text-[0.8438rem]";

  // Cálculo de liquidación (ambas modalidades comparten aguinaldo/vacaciones).
  const salary = Number(employee.monthlySalary);
  const causalDef = SEVERANCE_CAUSALES.find((c) => c.value === severanceCausal) ?? SEVERANCE_CAUSALES[0];
  const aguinaldo = b.aguinaldoAccrued ?? 0; // EXENTO de todo (Art. 97)
  const vacBruto = b.vacationBalanceValue ?? 0; // GRAVABLE: INSS laboral al pagarse
  const vacInss = round2(vacBruto * inssResolved.laboral);
  const vacNeto = round2(vacBruto - vacInss);
  // ROLLOVER siempre paga indemnización (sin causal); TERMINATION depende del Art. 48.
  const paysIndemnizacion = settlementKind === "ROLLOVER" ? true : causalDef.paysIndemnizacion;
  const indemnizacion = paysIndemnizacion
    ? Math.max(indemnizacionPayout(salary, anchor), round2(Math.max(b.indemnizacionAccrued ?? 0, salary)))
    : 0;
  const prestamos = b.loanOutstanding ?? 0;
  const total = round2(aguinaldo + vacNeto + indemnizacion - prestamos);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-[rgb(28_25_23/0.45)] transition-opacity duration-200 opacity-100`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed bottom-0 right-0 top-0 z-50 flex w-[min(430px,100vw)] translate-x-0 flex-col border-l border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-modal)] transition-transform duration-300 motion-reduce:transition-none"
        style={{ transitionTimingFunction: "var(--ease-drawer)" }}
        role="dialog"
        aria-modal="true"
        aria-label={`Perfil de ${employee.fullName}`}
      >
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 pb-4 pt-5">
          <div className="hm-avatar h-11 w-11 text-[0.9375rem]" style={{ background: `var(--color-${avatarAccent}-100)`, color: `var(--color-${avatarAccent}-700)` }}>
            {initials(employee.fullName)}
          </div>
          <div>
            <h2 className="text-[1.0625rem] font-bold tracking-tight text-[var(--color-text)]">{employee.fullName}</h2>
            <p className="text-[0.78rem] text-[var(--color-text-soft)]">
              {employee.position} · {branch?.code} — {branch?.name} · desde {fmtDateShort(employee.startDate)}
              {employee.endDate ? ` · fin ${fmtDateShort(employee.endDate)}` : ""}
            </p>
            <p className="text-[0.72rem] text-[var(--color-text-muted)]">
              Salario {fmtC(salary)}
              {employee.nationalId ? ` · Cédula ${employee.nationalId}` : " · Cédula sin registrar"}
              {employee.lastLiquidationAt ? ` · Última liquidación ${fmtDateShort(employee.lastLiquidationAt)}` : ""}
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar detalle" className="hm-icon-btn ml-auto">
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

            <p className="mb-0.5 mt-3 text-[0.625rem] font-bold uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
              Del salario del trabajador
            </p>
            <div className={dline}><span className="flex items-center gap-2 text-[var(--color-text-secondary)]">{sw("neto")}Neto al empleado</span><span className="font-mono tabular-nums text-[var(--color-success-600)]">{fmtC(b.netPay)}</span></div>
            <div className={dline}><span className="flex items-center gap-2 text-[var(--color-text-secondary)]">{sw("ret")}Retenciones <small className="text-[0.6875rem] text-[var(--color-text-soft)]">INSS {fmtRatePct(inssResolved.laboral)}{b.ir > 0 ? " + IR de ley" : " (sin retención de IR)"}</small></span><span className="font-mono tabular-nums text-[var(--color-text)]">{fmtC(amounts.ret)}</span></div>

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
            <div className={dline}><span className="text-[var(--color-text-secondary)]">Salario base</span><span className="font-mono tabular-nums text-[var(--color-text)]">{fmtC(salary)}</span></div>
            <div className={dline}><span className="text-[var(--color-text-secondary)]">Salario por día <small className="text-[0.6875rem] text-[var(--color-text-soft)]">÷30 · cada falta injustificada = −1 día</small></span><span className="font-mono tabular-nums text-[var(--color-text)]">{fmtC(b.dailyRate ?? round2(salary / 30))}</span></div>
            <div className={dline}>
              <span className="text-[var(--color-text-secondary)]">
                INSS laboral{" "}
                <small className="text-[0.6875rem] text-[var(--color-text-soft)]">
                  {fmtRatePct(inssResolved.laboral)}
                  {employee.inssSalary != null ? ` sobre base cotizable ${fmtC(Number(employee.inssSalary))}` : ""}{" "}
                  · se retiene y entera 1 vez al mes
                </small>
              </span>
              <span className="font-mono tabular-nums text-[var(--color-danger-600)]">− {fmtC(b.inssLaboral)}</span>
            </div>
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
              <span className="font-mono tabular-nums text-[var(--color-text)]">{fmtC(aguinaldo)}</span>
            </div>
            <div className={dline}>
              <span className="text-[var(--color-text-secondary)]">
                Vacaciones <small className="text-[0.6875rem] text-[var(--color-text-soft)]">{vacBalance.toLocaleString("es-NI", { maximumFractionDigits: 1 })} días de saldo</small>
                {chipGravable}
              </span>
              <span className="font-mono tabular-nums text-[var(--color-text)]">{fmtC(b.vacationBalanceValue ?? 0)}</span>
            </div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 pl-0">
              <p className="text-[0.6875rem] leading-relaxed text-[var(--color-text-soft)]">
                {b.vacationPeriodIndex != null ? (
                  <>
                    Año {b.vacationPeriodIndex + 1} de servicio
                    {b.vacationPeriodStart && b.vacationPeriodEnd ? ` (${fmtDateShort(b.vacationPeriodStart)} → ${fmtDateShort(b.vacationPeriodEnd)})` : ""}:{" "}
                    <strong className="text-[var(--color-text-muted)]">{(b.vacationPeriodAccrued ?? 0).toLocaleString("es-NI", { maximumFractionDigits: 1 })}/30 días</strong> acumulados este período.
                  </>
                ) : (
                  "Sin período de aniversario laboral en curso."
                )}
              </p>
              <button
                onClick={() => setVacationFormOpen((v) => !v)}
                className="shrink-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[0.6875rem] font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)]"
              >
                {vacationFormOpen ? "Cancelar" : "Registrar"}
              </button>
            </div>
            {vacationFormOpen && (
              <div className="mb-2 grid grid-cols-1 gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-2.5 sm:grid-cols-4">
                <label className="grid gap-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Fecha
                  <input type="date" max={new Date().toISOString().slice(0, 10)} value={vacationForm.date} onChange={(e) => setVacationForm({ ...vacationForm, date: e.target.value })} className="hm-input rounded-md text-xs font-normal normal-case" />
                </label>
                <label className="grid gap-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Días
                  <input type="number" step="0.5" min="0.5" value={vacationForm.days} onChange={(e) => setVacationForm({ ...vacationForm, days: e.target.value })} className="hm-input rounded-md text-xs font-normal normal-case" placeholder="Ej: 5" />
                </label>
                <label className="grid gap-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]" title="Gozadas: descansadas, salario normal. Pagadas: en dinero, gravan INSS/IR.">
                  Tipo
                  <select value={vacationForm.kind} onChange={(e) => setVacationForm({ ...vacationForm, kind: e.target.value as "GOZADAS" | "PAGADAS" })} className="hm-input rounded-md text-xs font-normal normal-case">
                    <option value="GOZADAS">Gozadas (descanso)</option>
                    <option value="PAGADAS">Pagadas (dinero)</option>
                  </select>
                </label>
                <button
                  onClick={() => void submitVacationEntry(employee.id)}
                  disabled={vacationSaving}
                  className="self-end rounded-md bg-[var(--color-info-600)] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-info-700)] disabled:opacity-50"
                >
                  {vacationSaving ? "Guardando…" : "Guardar"}
                </button>
              </div>
            )}
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
              {employee.lastLiquidationAt ? " Antigüedad contada desde la última liquidación (no desde el ingreso original)." : ""}
            </p>
          </section>

          {employee.isActive && (
            <section className="mb-6">
              <h4 className="mb-2.5 flex items-center gap-2 text-[0.6875rem] font-bold uppercase tracking-[0.07em] text-[var(--color-text-soft)] after:h-px after:flex-1 after:bg-[var(--color-border)]">
                Asistencia y liquidación
              </h4>
              <div className={dline}>
                <span className="text-[var(--color-text-secondary)]">Faltas este mes <small className="text-[0.6875rem] text-[var(--color-text-soft)]">las injustificadas restan {fmtC(b.dailyRate ?? round2(salary / 30))}/día</small></span>
                <span className="font-mono tabular-nums text-[var(--color-text)]">
                  {b.absencesMonthUnjustified ?? 0} injust. · {b.absencesMonthJustified ?? 0} just.
                </span>
              </div>
              <div className={dline}>
                <span className="text-[var(--color-text-secondary)]">Faltas injustificadas del año</span>
                <span className="font-mono tabular-nums text-[var(--color-text)]">{b.absencesYearUnjustified ?? 0}</span>
              </div>
              {(b.loanOutstanding ?? 0) > 0 && (
                <div className={dline}>
                  <span className="text-[var(--color-text-secondary)]">Préstamos pendientes <small className="text-[0.6875rem] text-[var(--color-text-soft)]">se descuentan al liquidar</small></span>
                  <span className="font-mono tabular-nums text-[var(--color-warning-600)]">{fmtC(b.loanOutstanding ?? 0)}</span>
                </div>
              )}

              {!liquidationOpen ? (
                <button
                  onClick={() => setLiquidationOpen(true)}
                  className="mt-2 w-full rounded-lg border-[1.5px] border-[var(--color-danger-200)] bg-[var(--color-danger-50)] px-4 py-2 text-sm font-semibold text-[var(--color-danger-700)] transition-colors hover:bg-[var(--color-danger-100)]"
                >
                  Liquidar (calcular según ley)
                </button>
              ) : (
                <div className="mt-2 rounded-xl border border-[var(--color-danger-200)] bg-[var(--color-surface-alt)] p-3">
                  <div className="hm-tabs-pill mb-2 grid grid-cols-2 gap-1 rounded-lg bg-[var(--color-surface)] p-1 text-[0.7rem]">
                    <button
                      onClick={() => { setSettlementKind("ROLLOVER"); setConfirmLiquidation(false); }}
                      className={`rounded-md px-2 py-1.5 font-semibold transition-colors ${settlementKind === "ROLLOVER" ? "bg-[var(--color-info-600)] text-white" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"}`}
                    >
                      Liquidar y recontratar
                    </button>
                    <button
                      onClick={() => { setSettlementKind("TERMINATION"); setConfirmLiquidation(false); }}
                      className={`rounded-md px-2 py-1.5 font-semibold transition-colors ${settlementKind === "TERMINATION" ? "bg-[var(--color-danger-600)] text-white" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"}`}
                    >
                      Dar de baja
                    </button>
                  </div>

                  {settlementKind === "ROLLOVER" ? (
                    <p className="text-[0.6875rem] leading-relaxed text-[var(--color-text-soft)]">
                      El trabajador SIGUE ACTIVO: se paga lo acumulado y se reinicia el reloj de antigüedad (indemnización,
                      vacaciones, aguinaldo). Evita que la indemnización crezca sin límite si nunca se liquida. La
                      indemnización siempre se paga en esta modalidad (no requiere causal).
                    </p>
                  ) : (
                    <label className="grid gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                      Causal de terminación
                      <select
                        value={severanceCausal}
                        onChange={(e) => { setSeveranceCausal(e.target.value as SeveranceCausal); setConfirmLiquidation(false); }}
                        className="hm-input rounded-lg text-sm font-normal normal-case"
                      >
                        {SEVERANCE_CAUSALES.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}{c.paysIndemnizacion ? "" : " — sin indemnización"}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  <div className="mt-2 space-y-1 text-[0.8125rem]">
                    <div className="flex items-baseline justify-between"><span className="text-[var(--color-text-secondary)]">Aguinaldo proporcional {chipExento}</span><span className="font-mono tabular-nums">{fmtC(aguinaldo)}</span></div>
                    <div className="flex items-baseline justify-between"><span className="text-[var(--color-text-secondary)]">Vacaciones ({(b.vacationDaysBalance ?? 0).toLocaleString("es-NI", { maximumFractionDigits: 1 })} días)</span><span className="font-mono tabular-nums">{fmtC(vacBruto)}</span></div>
                    {vacInss > 0 && (
                      <div className="flex items-baseline justify-between"><span className="text-[var(--color-text-secondary)] pl-3">− INSS {fmtRatePct(inssResolved.laboral)} sobre vacaciones <small className="text-[0.6875rem] text-[var(--color-text-soft)]">gravables al pagarse</small></span><span className="font-mono tabular-nums text-[var(--color-danger-600)]">− {fmtC(vacInss)}</span></div>
                    )}
                    <div className="flex items-baseline justify-between">
                      <span className="text-[var(--color-text-secondary)]">Indemnización Art. 45 {paysIndemnizacion ? chipExento : <span className="ml-1.5 text-[0.6875rem] text-[var(--color-text-soft)]">(no aplica por la causal)</span>}</span>
                      <span className="font-mono tabular-nums">{fmtC(indemnizacion)}</span>
                    </div>
                    {prestamos > 0 && (
                      <div className="flex items-baseline justify-between"><span className="text-[var(--color-text-secondary)]">Préstamos pendientes</span><span className="font-mono tabular-nums text-[var(--color-danger-600)]">− {fmtC(prestamos)}</span></div>
                    )}
                    <div className="flex items-baseline justify-between border-t border-[var(--color-border-strong)] pt-1.5 text-sm font-bold">
                      <span className="text-[var(--color-text)]">TOTAL A PAGAR</span>
                      <span className="font-mono tabular-nums text-[var(--color-success-600)]">{fmtC(Math.max(0, total))}</span>
                    </div>
                  </div>
                  <p className="mt-2 text-[0.6875rem] leading-relaxed text-[var(--color-text-soft)]">
                    Aguinaldo e indemnización: exentos (Arts. 93–99 y 45 CT, Ley 822). Vacaciones pagadas: gravan
                    INSS al pagarse. El salario pendiente del mes en curso se paga por la nómina normal, aparte.
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {!confirmLiquidation ? (
                      <>
                        <button
                          onClick={() => setConfirmLiquidation(true)}
                          className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors ${settlementKind === "ROLLOVER" ? "bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)]" : "bg-[var(--color-danger-600)] hover:bg-[var(--color-danger-700)]"}`}
                        >
                          {settlementKind === "ROLLOVER" ? "Liquidar y recontratar" : "Dar de baja (liquidar)"}
                        </button>
                        <button onClick={() => setLiquidationOpen(false)} className="rounded-lg px-3 py-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]">Cerrar</button>
                      </>
                    ) : (
                      <>
                        <span className={`text-xs font-semibold ${settlementKind === "ROLLOVER" ? "text-[var(--color-info-700)]" : "text-[var(--color-danger-700)]"}`}>
                          {settlementKind === "ROLLOVER"
                            ? `¿Confirmar liquidación y recontratación de ${employee.fullName} con total ${fmtC(Math.max(0, total))}? Sigue activo.`
                            : `¿Confirmar baja de ${employee.fullName} con total ${fmtC(Math.max(0, total))}?`}
                        </span>
                        <button
                          onClick={() => void submitSettlement()}
                          disabled={settling}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${settlementKind === "ROLLOVER" ? "bg-[var(--color-info-600)]" : "bg-[var(--color-danger-600)]"}`}
                        >
                          {settling ? "Procesando…" : "Sí, confirmar"}
                        </button>
                        <button onClick={() => setConfirmLiquidation(false)} className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]">No</button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="flex gap-2.5 border-t border-[var(--color-border)] px-5 py-4">
          {onEdit ? (
            <button
              onClick={onEdit}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)]"
            >
              Editar ficha
            </button>
          ) : (
            <Link
              href={(editHref ?? "/app/master/users") as Route}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)]"
            >
              Editar ficha
            </Link>
          )}
          {onGoToPayroll && (
            <button
              onClick={onGoToPayroll}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--color-info-600)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-info-700)]"
            >
              <Calculator className="h-4 w-4" /> Calcular nómina
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
