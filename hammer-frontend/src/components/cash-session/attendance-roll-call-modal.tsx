"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";

/**
 * Pase de asistencia — ventana emergente del POS (pantalla Cobros) ANTES del
 * primer pago del día: la caja ya está abierta con su monto contado, esto es
 * el recordatorio "no olvides marcar la asistencia" justo antes de empezar a
 * vender. Simple y rápido para el cajero: Presente / Ausente por trabajador,
 * SIN matices — Master revisa el detalle (llegó tarde, justificó, etc.)
 * después desde RRHH › Asistencia. Solo aparece una vez al día por sucursal.
 */

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

/** Simple para el cajero: solo vino o no vino. El detalle lo agrega Master. */
type SimpleStatus = "PRESENT" | "ABSENT";

export function AttendanceRollCallModal({
  branchId,
  onConfirmed,
}: {
  branchId: string;
  /** Se llama tras guardar el pase — el POS continúa hacia la venta. */
  onConfirmed: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [roster, setRoster] = useState<RosterEmployee[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SimpleStatus>>({});

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
      const initial: Record<string, SimpleStatus> = {};
      for (const emp of data.roster ?? []) initial[emp.id] = "PRESENT";
      for (const mark of data.marks ?? []) {
        if (mark.kind === "UNJUSTIFIED" || mark.kind === "JUSTIFIED") initial[mark.employeeId] = "ABSENT";
      }
      setStatuses(initial);
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
            // Ausente entra como injustificada por defecto: Master la revisa y
            // corrige (justificada, llegó tarde, etc.) antes de confirmar.
            status: (statuses[emp.id] ?? "PRESENT") === "ABSENT" ? "UNJUSTIFIED" : "PRESENT",
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

  const absentCount = roster.filter((e) => statuses[e.id] === "ABSENT").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(28_25_23/0.55)] p-4" role="dialog" aria-modal="true" aria-label="Pase de asistencia">
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-modal)]">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h3 className="text-base font-bold text-[var(--color-text)]">📋 No olvides marcar la asistencia</h3>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Antes de cobrar la primera venta de hoy, marca quién de tu sucursal está presente. Master revisará el
            detalle (tardanzas, justificaciones) después desde RRHH.
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
                  <div key={emp.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--color-text)]">{emp.fullName}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{emp.position}</p>
                    </div>
                    <div className="flex gap-1.5" role="radiogroup" aria-label={`Asistencia de ${emp.fullName}`}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={status === "PRESENT"}
                        onClick={() => setStatuses((s) => ({ ...s, [emp.id]: "PRESENT" }))}
                        className={`rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                          status === "PRESENT"
                            ? "border-transparent bg-[var(--color-success-600)] text-white"
                            : "border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        }`}
                      >
                        Presente
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={status === "ABSENT"}
                        onClick={() => setStatuses((s) => ({ ...s, [emp.id]: "ABSENT" }))}
                        className={`rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                          status === "ABSENT"
                            ? "border-transparent bg-[var(--color-danger-600)] text-white"
                            : "border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        }`}
                      >
                        Ausente
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {error && <p className="px-5 pt-3 text-xs text-[var(--color-danger-600)]">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-5 py-4">
          <span className="text-xs text-[var(--color-text-muted)]">
            {roster.length - absentCount} presente{roster.length - absentCount !== 1 ? "s" : ""} · {absentCount} ausente{absentCount !== 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={saving || loading}
            className="rounded-lg bg-[var(--color-info-600)] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-info-700)] disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Confirmar y continuar"}
          </button>
        </div>
      </div>
    </div>
  );
}
