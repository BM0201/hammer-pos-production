"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";

/**
 * Pase de asistencia — ventana emergente del POS ANTES de abrir caja.
 *
 * Muestra el personal ACTIVO de la sucursal (nombre + puesto), todos en
 * "Presente" por defecto; el cajero solo marca a quien faltó (injustificada
 * descuenta un día de pago en la nómina; justificada solo registra). Al
 * confirmar se guarda el pase y se continúa con la apertura. Solo aparece
 * una vez al día por sucursal; volverlo a abrir corrige las marcas.
 */

export type RollCallStatus = "PRESENT" | "UNJUSTIFIED" | "JUSTIFIED";

type RosterEmployee = { id: string; fullName: string; position: string };

type RollCallData = {
  taken: boolean;
  roster: RosterEmployee[];
  marks: Array<{ employeeId: string; kind: string; notes: string | null }>;
};

/** "YYYY-MM-DD" en hora LOCAL del dispositivo (Managua) — no UTC. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_OPTIONS: Array<{ value: RollCallStatus; label: string; activeCls: string }> = [
  { value: "PRESENT", label: "Presente", activeCls: "bg-[var(--color-success-600)] text-white border-transparent" },
  { value: "JUSTIFIED", label: "Falta just.", activeCls: "bg-[var(--color-warning-600)] text-white border-transparent" },
  { value: "UNJUSTIFIED", label: "Falta injust.", activeCls: "bg-[var(--color-danger-600)] text-white border-transparent" },
];

export function AttendanceRollCallModal({
  branchId,
  onConfirmed,
  onCancel,
}: {
  branchId: string;
  /** Se llama tras guardar el pase — el panel continúa abriendo la caja. */
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [roster, setRoster] = useState<RosterEmployee[]>([]);
  const [statuses, setStatuses] = useState<Record<string, RollCallStatus>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await apiFetch(`/api/payroll/attendance/roll-call?branchId=${branchId}&date=${localToday()}`);
      const raw = (await r.json()) as { data?: RollCallData; error?: { message?: string } };
      if (!r.ok) {
        setError(raw?.error?.message ?? "No se pudo cargar el personal.");
        return;
      }
      const data = raw.data as RollCallData;
      setRoster(data.roster ?? []);
      // Default: todos presentes; si ya hay marcas de hoy, se respetan.
      const initial: Record<string, RollCallStatus> = {};
      const initialNotes: Record<string, string> = {};
      for (const emp of data.roster ?? []) initial[emp.id] = "PRESENT";
      for (const mark of data.marks ?? []) {
        if (mark.kind === "UNJUSTIFIED" || mark.kind === "JUSTIFIED") {
          initial[mark.employeeId] = mark.kind;
          if (mark.notes) initialNotes[mark.employeeId] = mark.notes;
        }
      }
      setStatuses(initial);
      setNotes(initialNotes);
    } catch {
      setError("Error de red al cargar el personal.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { void load(); }, [load]);

  async function confirm() {
    setSaving(true);
    setError("");
    try {
      const r = await apiFetch("/api/payroll/attendance/roll-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          date: localToday(),
          entries: roster.map((emp) => ({
            employeeId: emp.id,
            status: statuses[emp.id] ?? "PRESENT",
            notes: notes[emp.id]?.trim() || undefined,
          })),
        }),
      });
      if (!r.ok) {
        const raw = (await r.json()) as { error?: { message?: string } };
        setError(raw?.error?.message ?? "No se pudo guardar el pase de asistencia.");
        return;
      }
      onConfirmed();
    } catch {
      setError("Error de red al guardar.");
    } finally {
      setSaving(false);
    }
  }

  const absentCount = roster.filter((e) => statuses[e.id] && statuses[e.id] !== "PRESENT").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(28_25_23/0.55)] p-4" role="dialog" aria-modal="true" aria-label="Pase de asistencia">
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-modal)]">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h3 className="text-base font-bold text-[var(--color-text)]">📋 Pase de asistencia</h3>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Antes de abrir la caja, confirma quién está hoy. Marca solo a quien faltó —
            la <strong>injustificada descuenta un día de pago</strong> en la nómina; la justificada solo se registra.
          </p>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {loading ? (
            <p className="px-5 py-6 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Cargando personal…</p>
          ) : roster.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-[var(--color-text-muted)]">
              Esta sucursal no tiene personal activo registrado en Planilla.
            </p>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {roster.map((emp) => {
                const status = statuses[emp.id] ?? "PRESENT";
                return (
                  <div key={emp.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[var(--color-text)]">{emp.fullName}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">{emp.position}</p>
                      </div>
                      <div className="flex gap-1" role="radiogroup" aria-label={`Asistencia de ${emp.fullName}`}>
                        {STATUS_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            role="radio"
                            aria-checked={status === opt.value}
                            onClick={() => setStatuses((s) => ({ ...s, [emp.id]: opt.value }))}
                            className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
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
                    {status !== "PRESENT" && (
                      <input
                        className="hm-input mt-2 w-full rounded-lg text-xs"
                        placeholder={status === "JUSTIFIED" ? "Motivo (ej: constancia médica)" : "Nota (opcional)"}
                        maxLength={300}
                        value={notes[emp.id] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [emp.id]: e.target.value }))}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {error && <p className="px-5 pt-3 text-xs text-[var(--color-danger-600)]">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-5 py-4">
          <span className="text-xs text-[var(--color-text-muted)]">
            {roster.length - absentCount} presente{roster.length - absentCount !== 1 ? "s" : ""} · {absentCount} falta{absentCount !== 1 ? "s" : ""}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-alt)]"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={saving || loading}
              className="rounded-lg bg-[var(--color-info-600)] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-info-700)] disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Confirmar y abrir caja"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
