"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarX2, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { isMasterOrAbove } from "@/modules/rbac/role-routing";
import { fmtC, fmtDateShort, round2 } from "./payroll-calc";

/**
 * Asistencia correlacionada con la nómina (Finanzas › Planilla › Asistencia).
 *
 * Regla: salario diario = mensual ÷ 30. Cada FALTA INJUSTIFICADA es un día de
 * pago menos en la nómina del mes (se descuenta sola al calcular la corrida);
 * las JUSTIFICADAS quedan registradas pero no descuentan. Una falta por
 * empleado por día — registrar de nuevo el mismo día corrige el tipo/nota.
 */

type EmployeeOption = {
  id: string;
  fullName: string;
  isActive: boolean;
  monthlySalary: string;
  payrollEstimate?: { dailyRate?: number } | null;
};

type Absence = {
  id: string;
  employeeId: string;
  date: string;
  kind: "UNJUSTIFIED" | "JUSTIFIED" | string;
  notes: string | null;
  employee: { id: string; fullName: string; position: string; monthlySalary: string };
};

const KIND_LABEL: Record<string, string> = { UNJUSTIFIED: "Injustificada", JUSTIFIED: "Justificada" };

type RollCallMarkStatus = "PRESENT" | "UNJUSTIFIED" | "JUSTIFIED";
type RollCallMark = {
  employeeId: string;
  status: RollCallMarkStatus;
  arrivalAt: string | null;
  notes: string | null;
  employee: { id: string; fullName: string; position: string };
};
type PendingRollCall = {
  id: string;
  date: string;
  presentCount: number;
  absentCount: number;
  branch: { id: string; code: string; name: string };
  marks: RollCallMark[];
};

const MARK_STATUS_OPTIONS: Array<{ value: RollCallMarkStatus; label: string; activeCls: string }> = [
  { value: "PRESENT", label: "Presente", activeCls: "bg-[var(--color-success-600)] text-white border-transparent" },
  { value: "JUSTIFIED", label: "Falta just.", activeCls: "bg-[var(--color-warning-600)] text-white border-transparent" },
  { value: "UNJUSTIFIED", label: "Falta injust.", activeCls: "bg-[var(--color-danger-600)] text-white border-transparent" },
];

/** "hh:mm am/pm" en hora LOCAL del dispositivo, para la hora de llegada. */
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-NI", { hour: "numeric", minute: "2-digit" });
}

/**
 * Pases de asistencia PENDIENTES de confirmar (solo Master): el cajero pasa
 * lista desde el POS, pero para evitar marcas falsas entre compañeros
 * ("buddy punching") Master debe confirmar o corregir cada pase antes de que
 * quede como definitivo.
 */
function PendingAttendanceReview() {
  const [pending, setPending] = useState<PendingRollCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [overrides, setOverrides] = useState<Record<string, Record<string, RollCallMarkStatus>>>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch("/api/payroll/attendance/roll-call/pending");
      const data = unwrapApiData(await r.json());
      setPending(Array.isArray(data) ? (data as PendingRollCall[]) : []);
    } catch {
      toast.error("Error al cargar pases pendientes de confirmar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function statusOf(rollCallId: string, mark: RollCallMark): RollCallMarkStatus {
    return overrides[rollCallId]?.[mark.employeeId] ?? mark.status;
  }

  function setOverride(rollCallId: string, employeeId: string, status: RollCallMarkStatus) {
    setOverrides((prev) => ({ ...prev, [rollCallId]: { ...prev[rollCallId], [employeeId]: status } }));
  }

  async function confirm(rollCall: PendingRollCall) {
    setConfirmingId(rollCall.id);
    try {
      const rollCallOverrides = overrides[rollCall.id] ?? {};
      const corrections = Object.entries(rollCallOverrides)
        .filter(([employeeId, status]) => {
          const original = rollCall.marks.find((m) => m.employeeId === employeeId)?.status;
          return original !== status;
        })
        .map(([employeeId, status]) => ({ employeeId, status }));

      const r = await apiFetch(`/api/payroll/attendance/roll-call/${rollCall.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corrections }),
      });
      if (!r.ok) {
        const raw = (await r.json()) as { error?: { message?: string } };
        toast.error(raw?.error?.message ?? "No se pudo confirmar el pase");
        return;
      }
      toast.success(corrections.length > 0 ? "Asistencia confirmada con correcciones" : "Asistencia confirmada");
      await load();
    } catch {
      toast.error("Error de conexión");
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <div
      className={`hm-module-card p-4 space-y-3 ${
        pending.length > 0 ? "border-[var(--color-warning-200)] bg-[var(--color-warning-50)]/40" : ""
      }`}
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
        <ShieldCheck className="h-4 w-4 text-[var(--color-warning-600)]" /> Pendientes de confirmar{pending.length > 0 ? ` (${pending.length})` : ""}
      </h3>
      <p className="text-xs text-[var(--color-text-muted)]">
        El cajero pasa esta lista desde el POS antes de abrir caja. Aquí revisas la hora de llegada de cada quien y
        corriges cualquier marca falsa antes de confirmar — solo Master puede confirmar, para evitar que se marquen
        presentes entre compañeros.
      </p>
      {loading ? (
        <p className="text-xs text-[var(--color-text-muted)] animate-pulse">Cargando…</p>
      ) : pending.length === 0 ? (
        <p className="text-xs text-[var(--color-text-soft)]">Sin pases pendientes — todo lo tomado hoy ya está confirmado.</p>
      ) : (
      <div className="space-y-3">
        {pending.map((rc) => (
          <div key={rc.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {rc.branch.code} — {rc.branch.name} <span className="text-[var(--color-text-muted)]">· {fmtDateShort(rc.date)}</span>
              </p>
              <button
                onClick={() => void confirm(rc)}
                disabled={confirmingId === rc.id}
                className="rounded-lg bg-[var(--color-info-600)] px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-info-700)] disabled:opacity-50"
              >
                {confirmingId === rc.id ? "Confirmando…" : "Confirmar asistencia"}
              </button>
            </div>
            <div className="divide-y divide-[var(--color-border)]">
              {rc.marks.map((mark) => {
                const status = statusOf(rc.id, mark);
                return (
                  <div key={mark.employeeId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text)]">{mark.employee.fullName}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {mark.employee.position} · llegó {fmtTime(mark.arrivalAt)}
                      </p>
                    </div>
                    <div className="flex gap-1" role="radiogroup" aria-label={`Asistencia de ${mark.employee.fullName}`}>
                      {MARK_STATUS_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={status === opt.value}
                          onClick={() => setOverride(rc.id, mark.employeeId, opt.value)}
                          className={`rounded-lg border px-2 py-1 text-[0.7rem] font-semibold transition-colors ${
                            status === opt.value
                              ? opt.activeCls
                              : "border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

export function AttendancePanel() {
  const sessionState = useSession();
  const isMaster = sessionState.status === "authenticated" &&
    isMasterOrAbove(sessionState.session.roleCode as string, sessionState.session.globalRoles as unknown as string[]);
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    employeeId: "",
    date: new Date().toISOString().slice(0, 10),
    kind: "UNJUSTIFIED" as "UNJUSTIFIED" | "JUSTIFIED",
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [year, month] = period.split("-").map(Number);
      const [empRes, absRes] = await Promise.all([
        apiFetch("/api/employees"),
        apiFetch(`/api/payroll/absences?year=${year}&month=${month}`),
      ]);
      const empData = unwrapApiData(await empRes.json());
      setEmployees(Array.isArray(empData) ? (empData as EmployeeOption[]) : []);
      const absData = unwrapApiData(await absRes.json()) as { absences?: Absence[] } | null;
      setAbsences(Array.isArray(absData?.absences) ? absData.absences : []);
    } catch {
      toast.error("Error al cargar la asistencia");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  const dailyRateOf = useCallback((emp: { monthlySalary: string; payrollEstimate?: { dailyRate?: number } | null }) => {
    return emp.payrollEstimate?.dailyRate ?? round2(Number(emp.monthlySalary) / 30);
  }, []);

  const selectedEmployee = employees.find((e) => e.id === form.employeeId) ?? null;

  // Resumen del mes: injustificadas por empleado → cuánto le baja la nómina.
  const summary = useMemo(() => {
    const byEmp = new Map<string, { name: string; days: number; deduction: number }>();
    for (const a of absences) {
      if (a.kind !== "UNJUSTIFIED") continue;
      const daily = round2(Number(a.employee.monthlySalary) / 30);
      const prev = byEmp.get(a.employeeId) ?? { name: a.employee.fullName, days: 0, deduction: 0 };
      prev.days += 1;
      prev.deduction = round2(prev.deduction + daily);
      byEmp.set(a.employeeId, prev);
    }
    return [...byEmp.values()].sort((a, b) => b.deduction - a.deduction);
  }, [absences]);

  async function submit() {
    if (!form.employeeId) {
      toast.error("Selecciona el empleado");
      return;
    }
    setSaving(true);
    try {
      const r = await apiFetch("/api/payroll/absences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, notes: form.notes.trim() || undefined }),
      });
      if (!r.ok) {
        const raw = (await r.json()) as { error?: { message?: string } };
        toast.error(raw?.error?.message ?? "No se pudo registrar la falta");
        return;
      }
      toast.success(form.kind === "UNJUSTIFIED" ? "Falta injustificada registrada — se descuenta al calcular la nómina" : "Falta justificada registrada (no descuenta)");
      setForm((f) => ({ ...f, notes: "" }));
      await load();
    } catch {
      toast.error("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    try {
      const r = await apiFetch(`/api/payroll/absences/${id}`, { method: "DELETE" });
      if (!r.ok) {
        toast.error("No se pudo eliminar");
        return;
      }
      toast.success("Falta eliminada");
      await load();
    } catch {
      toast.error("Error de conexión");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Pendientes de confirmar (solo Master) ── */}
      {isMaster && <PendingAttendanceReview />}

      {/* ── Registro ── */}
      <div className="hm-module-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
            <CalendarX2 className="h-4 w-4 text-[var(--color-danger-600)]" /> Registrar falta
          </h3>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            Mes
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="hm-input rounded-lg text-sm" />
          </label>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Empleado *
            <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case">
              <option value="">Seleccionar...</option>
              {employees.filter((e) => e.isActive).map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Fecha *
            <input type="date" value={form.date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setForm({ ...form, date: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case" />
          </label>
          <label className="grid gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Tipo *
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "UNJUSTIFIED" | "JUSTIFIED" })} className="hm-input rounded-lg text-sm font-normal normal-case">
              <option value="UNJUSTIFIED">Injustificada — descuenta un día</option>
              <option value="JUSTIFIED">Justificada — no descuenta</option>
            </select>
          </label>
          <label className="grid gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Nota (opcional)
            <input value={form.notes} maxLength={300} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="hm-input rounded-lg text-sm font-normal normal-case" placeholder="Ej: no avisó / constancia médica" />
          </label>
        </div>
        {/* La cuenta a la vista: cuánto vale el día de ESTE empleado. */}
        {selectedEmployee && (
          <p className="text-xs text-[var(--color-text-muted)]">
            {selectedEmployee.fullName} gana <strong className="text-[var(--color-text)]">{fmtC(dailyRateOf(selectedEmployee))} por día</strong> (salario ÷ 30).
            {form.kind === "UNJUSTIFIED"
              ? <> Esta falta le descuenta <strong className="text-[var(--color-danger-600)]">−{fmtC(dailyRateOf(selectedEmployee))}</strong> de la nómina del mes.</>
              : " Justificada: queda registrada, no descuenta."}
          </p>
        )}
        <button
          onClick={() => void submit()}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-[var(--color-info-600)] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-info-700)] disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarX2 className="h-4 w-4" />}
          Registrar falta
        </button>
      </div>

      {/* ── Resumen del mes (lo que baja la nómina) ── */}
      {summary.length > 0 && (
        <div className="hm-module-card p-4">
          <h4 className="mb-2 text-[0.8125rem] font-bold text-[var(--color-text)]">Impacto en la nómina de este mes</h4>
          <div className="flex flex-wrap gap-2">
            {summary.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] px-3 py-1 text-xs font-semibold text-[var(--color-danger-700)]">
                {s.name}: {s.days} falta{s.days !== 1 ? "s" : ""} injustificada{s.days !== 1 ? "s" : ""} → −{fmtC(s.deduction)}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[0.6875rem] text-[var(--color-text-soft)]">
            El descuento se aplica solo al <strong>Calcular Nómina</strong> del mes (columna Faltas) y cae en la 2ª quincena, como el resto de deducciones.
          </p>
        </div>
      )}

      {/* ── Faltas del mes ── */}
      <div className="hm-module-card">
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <h4 className="text-[0.8125rem] font-bold text-[var(--color-text)]">Faltas registradas · {period}</h4>
        </div>
        {loading ? (
          <p className="px-4 py-4 text-xs text-[var(--color-text-muted)] animate-pulse">Cargando…</p>
        ) : absences.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-[var(--color-text-muted)]">Sin faltas registradas este mes — asistencia perfecta.</p>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {absences.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold ${
                    a.kind === "UNJUSTIFIED"
                      ? "border-[var(--color-danger-200)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)]"
                      : "border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"
                  }`}
                >
                  {KIND_LABEL[a.kind] ?? a.kind}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    {a.employee.fullName} <span className="text-[var(--color-text-muted)]">· {fmtDateShort(a.date)}</span>
                  </p>
                  {a.notes && <p className="truncate text-xs text-[var(--color-text-muted)]">{a.notes}</p>}
                </div>
                {a.kind === "UNJUSTIFIED" && (
                  <span className="shrink-0 font-mono text-sm font-semibold text-[var(--color-danger-600)]">
                    −{fmtC(round2(Number(a.employee.monthlySalary) / 30))}
                  </span>
                )}
                <button
                  onClick={() => void remove(a.id)}
                  disabled={deletingId === a.id}
                  className="hm-icon-btn text-[var(--color-danger-600)] disabled:opacity-50"
                  title="Eliminar (registrada por error)"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
