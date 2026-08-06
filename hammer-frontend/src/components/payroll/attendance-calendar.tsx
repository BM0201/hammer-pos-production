"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import toast from "react-hot-toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { fmtDateShort, initials } from "@/components/finance/payroll-calc";

/**
 * Calendario de asistencia (RRHH, tab propio): un mes con quién vino cada
 * día, coloreado por estado, con un desglose completo al hacer clic en un
 * día. Vive separado del tab Asistencia (registrar faltas / confirmar
 * pases) para no aglomerar todo en una sola pantalla.
 */

type CalendarMarkStatus = "PRESENT" | "PRESENT_LATE" | "JUSTIFIED" | "UNJUSTIFIED";
type CalendarMark = {
  date: string;
  employeeId: string;
  employeeName: string;
  position: string;
  status: CalendarMarkStatus;
  arrivalAt: string | null;
  notes: string | null;
};
type CalendarBranch = { id: string; code: string; name: string };

/** Mismos colores que "Pendientes de confirmar" (Asistencia): un color por estado, consistente en todo RRHH. */
const CALENDAR_STATUS_STYLE: Record<CalendarMarkStatus, { bg: string; label: string }> = {
  PRESENT: { bg: "var(--color-success-600)", label: "Presente" },
  PRESENT_LATE: { bg: "var(--color-info-600)", label: "Llegó tarde" },
  JUSTIFIED: { bg: "var(--color-warning-600)", label: "Falta justificada" },
  UNJUSTIFIED: { bg: "var(--color-danger-600)", label: "Falta injustificada" },
};

const WEEKDAY_LABELS = ["D", "L", "M", "M", "J", "V", "S"];

/** "hh:mm am/pm" en hora LOCAL del dispositivo, para la hora de llegada. */
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-NI", { hour: "numeric", minute: "2-digit" });
}

/** Cuadrícula del mes (semanas de 7), con relleno null antes/después para alinear con el día de la semana. */
function buildMonthGrid(year: number, month: number): Array<Date | null> {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: Array<Date | null> = new Array(first.getUTCDay()).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(Date.UTC(year, month - 1, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function AttendanceCalendar() {
  const [branches, setBranches] = useState<CalendarBranch[]>([]);
  const [branchId, setBranchId] = useState("");
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [marks, setMarks] = useState<CalendarMark[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((j) => {
        const data = unwrapApiData(j);
        const list = Array.isArray(data) ? (data as CalendarBranch[]) : [];
        setBranches(list);
        setBranchId((current) => current || list[0]?.id || "");
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const [year, month] = period.split("-").map(Number);
      const r = await apiFetch(`/api/payroll/attendance/calendar?branchId=${branchId}&year=${year}&month=${month}`);
      const data = unwrapApiData(await r.json()) as { marks?: CalendarMark[] } | null;
      setMarks(Array.isArray(data?.marks) ? data.marks : []);
    } catch {
      toast.error("Error al cargar el calendario de asistencia");
    } finally {
      setLoading(false);
    }
  }, [branchId, period]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSelectedDate(null); }, [branchId, period]);

  const [year, month] = period.split("-").map(Number);
  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const marksByDate = useMemo(() => {
    const map = new Map<string, CalendarMark[]>();
    for (const m of marks) map.set(m.date, [...(map.get(m.date) ?? []), m]);
    return map;
  }, [marks]);

  const branchName = branches.find((b) => b.id === branchId);
  const selectedMarks = selectedDate ? (marksByDate.get(selectedDate) ?? []) : [];

  return (
    <div className="space-y-4">
      <div className="hm-module-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
            <CalendarDays className="h-4 w-4 text-[var(--color-info-600)]" /> Calendario de asistencia
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="hm-input rounded-lg text-sm">
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="hm-input rounded-lg text-sm" />
          </div>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {(Object.entries(CALENDAR_STATUS_STYLE) as Array<[CalendarMarkStatus, { bg: string; label: string }]>).map(([key, s]) => (
            <span key={key} className="flex items-center gap-1.5 text-[0.7rem] text-[var(--color-text-muted)]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.bg }} />
              {s.label}
            </span>
          ))}
        </div>

        {loading ? (
          <p className="text-xs text-[var(--color-text-muted)] animate-pulse">Cargando…</p>
        ) : !branchId ? (
          <p className="text-xs text-[var(--color-text-soft)]">Sin sucursales disponibles.</p>
        ) : (
          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAY_LABELS.map((w, i) => (
              <div key={i} className="text-center text-[0.625rem] font-bold uppercase tracking-wide text-[var(--color-text-soft)]">{w}</div>
            ))}
            {grid.map((date, i) => {
              if (!date) return <div key={i} />;
              const iso = date.toISOString().slice(0, 10);
              const dayMarks = marksByDate.get(iso) ?? [];
              const hasData = dayMarks.length > 0;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => hasData && setSelectedDate(iso)}
                  disabled={!hasData}
                  className={`min-h-[4rem] rounded-lg border p-1 text-left transition-colors ${
                    hasData
                      ? "cursor-pointer border-[var(--color-border)] bg-[var(--color-surface-alt)] hover:border-[var(--color-info-400)] hover:bg-[var(--color-info-50)]"
                      : "cursor-default border-[var(--color-border)] bg-[var(--color-surface-alt)] opacity-60"
                  }`}
                >
                  <p className="text-[0.625rem] font-semibold text-[var(--color-text-muted)]">{date.getUTCDate()}</p>
                  <div className="mt-0.5 flex flex-wrap gap-0.5">
                    {dayMarks.map((m) => (
                      <span
                        key={m.employeeId}
                        title={`${m.employeeName} · ${CALENDAR_STATUS_STYLE[m.status]?.label ?? m.status}${m.notes ? ` — ${m.notes}` : ""}`}
                        className="flex h-4 w-4 items-center justify-center rounded-full text-[0.5rem] font-bold text-white"
                        style={{ background: CALENDAR_STATUS_STYLE[m.status]?.bg ?? "var(--color-text-soft)" }}
                      >
                        {initials(m.employeeName)}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Desglose completo del día seleccionado ── */}
      {selectedDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(28_25_23/0.55)] p-4" role="dialog" aria-modal="true" aria-label="Desglose de asistencia del día">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-modal)]">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-[var(--color-text)]">{fmtDateShort(selectedDate)}</h3>
                <p className="text-xs text-[var(--color-text-muted)]">{branchName ? `${branchName.code} — ${branchName.name}` : ""}</p>
              </div>
              <button onClick={() => setSelectedDate(null)} aria-label="Cerrar" className="hm-icon-btn">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[60vh] divide-y divide-[var(--color-border)] overflow-y-auto">
              {selectedMarks.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-[var(--color-text-muted)]">Sin pase de asistencia registrado ese día.</p>
              ) : (
                selectedMarks.map((m) => {
                  const style = CALENDAR_STATUS_STYLE[m.status];
                  return (
                    <div key={m.employeeId} className="flex items-center gap-3 px-5 py-3">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ background: style?.bg ?? "var(--color-text-soft)" }}
                      >
                        {initials(m.employeeName)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[var(--color-text)]">{m.employeeName}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {m.position}
                          {m.arrivalAt ? ` · llegó ${fmtTime(m.arrivalAt)}` : ""}
                        </p>
                        {m.notes && <p className="mt-0.5 text-xs text-[var(--color-text-soft)]">{m.notes}</p>}
                      </div>
                      <span
                        className="shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold text-white"
                        style={{ background: style?.bg ?? "var(--color-text-soft)" }}
                      >
                        {style?.label ?? m.status}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
