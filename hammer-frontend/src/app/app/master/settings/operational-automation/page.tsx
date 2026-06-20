"use client";

import { useEffect, useState } from "react";
import { Save, Sunrise, ShieldCheck, Activity, Wallet, AlertTriangle } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { showToast } from "@/components/ui/toast";

type AutomationPayload = {
  config: {
    operationalDay: {
      autoOpenEnabled: boolean;
      autoCloseEnabled: boolean;
      timezone: string;
      weekdayOpenTime: string | null;
      saturdayOpenTime: string | null;
      sundayOpenTime: string | null;
      weekdayCloseTime: string | null;
      saturdayCloseTime: string | null;
      sundayCloseTime: string | null;
      allowOpenDayWhenOpeningCashSession: boolean;
    };
    cashSessions: {
      autoCloseEnabled: boolean;
      timezone: string;
      weekdayCloseTime: string | null;
      saturdayCloseTime: string | null;
      sundayCloseTime: string | null;
      autoCloseAction: "PENDING_REVIEW" | "DIRECT_CLOSE";
    };
    safetyRules: {
      blockDayCloseWithOpenCashSessions: true;
      blockDayCloseWithReconcilingCashSessions: true;
      blockDayCloseWithPendingReviews: true;
      blockDayCloseWithPendingPayments: true;
    };
  };
  status: {
    currentOperationalDays: Array<{
      branchId: string;
      branchCode: string;
      branchName: string;
      operationalDayId: string | null;
      businessDate: string | null;
      status: string | null;
      openedAt: string | null;
    }>;
    staleOpenOperationalDays: Array<{ id: string; branchCode: string; branchName: string; businessDate: string; openedAt: string }>;
    cashSessions: { open: number; reconciling: number; autoClosedPendingReview: number; stalePending: number };
    pendingPaymentsToday: number;
    lastAutomationRun: string | null;
    problems: string[];
  };
};

const TIMEZONES = [
  "America/Managua",
  "America/Tegucigalpa",
  "America/Guatemala",
  "America/Costa_Rica",
  "America/El_Salvador",
  "America/Mexico_City",
];

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-[var(--color-text)]">{label}</p>
        <p className="text-xs text-[var(--color-text-muted)]">{description}</p>
      </div>
      <label className="relative inline-flex cursor-pointer items-center">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only peer" />
        <div className="h-6 w-11 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-alt)] after:absolute after:left-[3px] after:top-[3px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[var(--color-master-600)] peer-checked:after:translate-x-5" />
      </label>
    </div>
  );
}

function TimeInput({ label, value, disabled, onChange }: { label: string; value: string | null; disabled?: boolean; onChange: (v: string | null) => void }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium text-[var(--color-text-secondary)]">{label}</span>
      <input
        type="time"
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm disabled:opacity-50"
      />
    </label>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string | number; tone?: "neutral" | "warning" | "danger" | "success" }) {
  const color = tone === "danger" ? "danger" : tone === "warning" ? "warning" : tone === "success" ? "success" : "neutral";
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1"><Badge variant={color}>{value}</Badge></div>
    </div>
  );
}

export default function OperationalAutomationPage() {
  const [payload, setPayload] = useState<AutomationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/master/operational-automation-config")
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((json) => {
        if (!cancelled) setPayload(unwrapApiData(json) as AutomationPayload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudo cargar la configuracion.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  function patchConfig(next: Partial<AutomationPayload["config"]>) {
    setPayload((prev) => prev ? { ...prev, config: { ...prev.config, ...next } } : prev);
  }

  async function save() {
    if (!payload) return;
    setSaving(true);
    try {
      const response = await apiFetch("/api/master/operational-automation-config", {
        method: "PUT",
        body: JSON.stringify(payload.config),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error?.message ?? `HTTP ${response.status}`);
      setPayload(unwrapApiData(json) as AutomationPayload);
      showToast("success", "Automatizacion operativa guardada.");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No se pudo guardar la configuracion.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="animate-pulse text-sm text-[var(--color-text-muted)]">Cargando automatizacion operativa...</p>;
  if (error || !payload) return <p className="text-sm text-[var(--color-danger-600)]">No se pudo cargar la configuracion: {error}</p>;

  const { config, status } = payload;
  const day = config.operationalDay;
  const cash = config.cashSessions;

  return (
    <section className="max-w-5xl space-y-6 animate-fade-in-up">
      <div className="flex items-center gap-3">
        <div className="hm-section-icon hm-section-icon-master"><Activity className="h-4 w-4" /></div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Automatizacion Operativa</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Apertura de dia, cierre de cajas y cierre operativo automatico</p>
        </div>
      </div>

      <Card className="space-y-4">
        <div className="flex items-center gap-2.5">
          <Sunrise className="h-4 w-4 text-[var(--color-master-600)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Dia Operativo</h2>
        </div>
        <ToggleRow
          label="Apertura automatica"
          description="Permite abrir el dia por horario y al abrir la primera caja."
          checked={day.autoOpenEnabled}
          onChange={(autoOpenEnabled) => patchConfig({ operationalDay: { ...day, autoOpenEnabled, allowOpenDayWhenOpeningCashSession: autoOpenEnabled } })}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <TimeInput label="Apertura lunes-viernes" value={day.weekdayOpenTime} disabled={!day.autoOpenEnabled} onChange={(weekdayOpenTime) => patchConfig({ operationalDay: { ...day, weekdayOpenTime } })} />
          <TimeInput label="Apertura sabado" value={day.saturdayOpenTime} disabled={!day.autoOpenEnabled} onChange={(saturdayOpenTime) => patchConfig({ operationalDay: { ...day, saturdayOpenTime } })} />
          <TimeInput label="Apertura domingo" value={day.sundayOpenTime} disabled={!day.autoOpenEnabled} onChange={(sundayOpenTime) => patchConfig({ operationalDay: { ...day, sundayOpenTime } })} />
        </div>
        <ToggleRow
          label="Cierre automatico del dia"
          description="Cierra solo si no hay cajas abiertas, conciliando, pendientes o pagos pendientes."
          checked={day.autoCloseEnabled}
          onChange={(autoCloseEnabled) => patchConfig({ operationalDay: { ...day, autoCloseEnabled } })}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <TimeInput label="Cierre lunes-viernes" value={day.weekdayCloseTime} disabled={!day.autoCloseEnabled} onChange={(weekdayCloseTime) => patchConfig({ operationalDay: { ...day, weekdayCloseTime } })} />
          <TimeInput label="Cierre sabado" value={day.saturdayCloseTime} disabled={!day.autoCloseEnabled} onChange={(saturdayCloseTime) => patchConfig({ operationalDay: { ...day, saturdayCloseTime } })} />
          <TimeInput label="Cierre domingo" value={day.sundayCloseTime} disabled={!day.autoCloseEnabled} onChange={(sundayCloseTime) => patchConfig({ operationalDay: { ...day, sundayCloseTime } })} />
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center gap-2.5">
          <Wallet className="h-4 w-4 text-[var(--color-master-600)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Cajas</h2>
        </div>
        <ToggleRow
          label="Cierre automatico de cajas"
          description="Cierra cajas abiertas por horario y las deja pendientes de revision por Master."
          checked={cash.autoCloseEnabled}
          onChange={(autoCloseEnabled) => patchConfig({ cashSessions: { ...cash, autoCloseEnabled } })}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <TimeInput label="Cierre lunes-viernes" value={cash.weekdayCloseTime} disabled={!cash.autoCloseEnabled} onChange={(weekdayCloseTime) => patchConfig({ cashSessions: { ...cash, weekdayCloseTime } })} />
          <TimeInput label="Cierre sabado" value={cash.saturdayCloseTime} disabled={!cash.autoCloseEnabled} onChange={(saturdayCloseTime) => patchConfig({ cashSessions: { ...cash, saturdayCloseTime } })} />
          <TimeInput label="Cierre domingo" value={cash.sundayCloseTime} disabled={!cash.autoCloseEnabled} onChange={(sundayCloseTime) => patchConfig({ cashSessions: { ...cash, sundayCloseTime } })} />
        </div>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-[var(--color-text-secondary)]">Accion del cierre automatico</span>
          <select
            value={cash.autoCloseAction}
            onChange={(event) => patchConfig({ cashSessions: { ...cash, autoCloseAction: event.target.value as "PENDING_REVIEW" | "DIRECT_CLOSE" } })}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          >
            <option value="PENDING_REVIEW">Marcar como pendiente de revision</option>
            <option value="DIRECT_CLOSE" disabled>Cerrar directo (requiere conciliacion segura)</option>
          </select>
        </label>
        <select
          value={day.timezone}
          onChange={(event) => {
            patchConfig({
              operationalDay: { ...day, timezone: event.target.value },
              cashSessions: { ...cash, timezone: event.target.value },
            });
          }}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
        >
          {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="h-4 w-4 text-[var(--color-master-600)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Reglas de seguridad</h2>
        </div>
        {[
          "No cerrar dia si hay cajas abiertas.",
          "No cerrar dia si hay cajas en conciliacion.",
          "No cerrar dia si hay cajas auto-cerradas pendientes de revision.",
          "No cerrar dia si hay pagos pendientes.",
          "Alertar al Master cuando existan sesiones viejas pendientes.",
        ].map((rule) => (
          <div key={rule} className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <Badge variant="success">Activo</Badge>
            <span>{rule}</span>
          </div>
        ))}
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center gap-2.5">
          <Activity className="h-4 w-4 text-[var(--color-master-600)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Estado del sistema</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Cajas abiertas" value={status.cashSessions.open} tone={status.cashSessions.open > 0 ? "warning" : "success"} />
          <Stat label="Cajas en conciliacion" value={status.cashSessions.reconciling} tone={status.cashSessions.reconciling > 0 ? "warning" : "success"} />
          <Stat label="Pendientes de revision" value={status.cashSessions.autoClosedPendingReview} tone={status.cashSessions.autoClosedPendingReview > 0 ? "danger" : "success"} />
          <Stat label="Pagos pendientes hoy" value={status.pendingPaymentsToday} tone={status.pendingPaymentsToday > 0 ? "danger" : "success"} />
        </div>
        <div className="rounded-lg border border-[var(--color-border)]">
          <div className="grid grid-cols-[0.7fr_1.3fr_1fr] gap-2 border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)]">
            <span>Sucursal</span><span>Dia operativo actual</span><span>Estado</span>
          </div>
          {status.currentOperationalDays.map((dayStatus) => (
            <div key={dayStatus.branchId} className="grid grid-cols-[0.7fr_1.3fr_1fr] gap-2 border-b border-[var(--color-border)] px-3 py-2 text-sm last:border-0">
              <span className="font-medium">{dayStatus.branchCode}</span>
              <span>{dayStatus.businessDate ? new Date(dayStatus.businessDate).toLocaleDateString("es-NI") : "Sin dia operativo"}</span>
              <span>{dayStatus.status ?? "NO_OPERATIONAL_DAY"}</span>
            </div>
          ))}
        </div>
        {status.staleOpenOperationalDays.length > 0 ? (
          <div className="rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-3 text-sm text-[var(--color-danger-700)]">
            <div className="mb-2 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Dias viejos abiertos</div>
            {status.staleOpenOperationalDays.map((item) => (
              <p key={item.id}>{item.branchCode} - {new Date(item.businessDate).toLocaleDateString("es-NI")}</p>
            ))}
          </div>
        ) : null}
        <div className="text-xs text-[var(--color-text-muted)]">
          Ultima ejecucion automatica: {status.lastAutomationRun ? new Date(status.lastAutomationRun).toLocaleString("es-NI") : "Sin registro"}
        </div>
        {status.problems.length > 0 ? (
          <div className="space-y-1 text-sm text-[var(--color-warning-700)]">
            {status.problems.map((problem) => <p key={problem}>{problem}</p>)}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-success-700)]">No hay problemas detectados.</p>
        )}
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} loading={saving} icon={<Save className="h-4 w-4" />}>Guardar configuracion</Button>
      </div>
    </section>
  );
}
