"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { showToast } from "@/components/ui/toast";
import { Clock, Save, Power, CalendarClock, Info } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

type CashAutoCloseConfig = {
  enabled: boolean;
  timezone: string;
  weekdayCloseTime: string | null;
  saturdayCloseTime: string | null;
  sundayCloseTime: string | null;
};

const TIMEZONE_OPTIONS = [
  "America/Managua",
  "America/Tegucigalpa",
  "America/Guatemala",
  "America/Costa_Rica",
  "America/El_Salvador",
  "America/Mexico_City",
];

/** One configurable day row: a toggle + time picker. */
function DayTimeRow({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled: boolean;
}) {
  const active = value !== null;
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-[var(--color-border)] last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--color-text)]">{label}</p>
        <p className="text-xs text-[var(--color-text-muted)]">{description}</p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={active}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked ? "17:30" : null)}
            className="h-4 w-4 accent-[var(--color-master-600)]"
          />
          <span className="text-xs text-[var(--color-text-secondary)]">
            {active ? "Activo" : "Sin cierre"}
          </span>
        </label>
        <input
          type="time"
          value={value ?? ""}
          disabled={disabled || !active}
          onChange={(e) => onChange(e.target.value || null)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-mono text-[var(--color-text)] disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[var(--color-master-400)]"
        />
      </div>
    </div>
  );
}

export default function CashAutoCloseSettingsPage() {
  const [config, setConfig] = useState<CashAutoCloseConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/master/cash-auto-close-config")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setConfig(unwrapApiData(data) as CashAutoCloseConfig);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? "No se pudo cargar la configuración");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function patch(next: Partial<CashAutoCloseConfig>) {
    setConfig((prev) => (prev ? { ...prev, ...next } : prev));
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/master/cash-auto-close-config", {
        method: "PUT",
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setConfig(unwrapApiData(data) as CashAutoCloseConfig);
      showToast("success", "Configuración de cierre automático guardada.");
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-[var(--color-text-muted)] animate-pulse">Cargando configuración…</p>;
  }
  if (error || !config) {
    return <p className="text-[var(--color-danger-600)]">No se pudo cargar la configuración: {error}</p>;
  }

  const disabled = !config.enabled;

  return (
    <section className="space-y-8 animate-fade-in-up max-w-3xl">
      {/* ── Page Header ── */}
      <div className="flex items-center gap-3">
        <div
          className="h-8 w-1 rounded-full"
          style={{ background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))" }}
        />
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Cierre Automático de Cajas</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Configure a qué hora se cierran automáticamente todas las cajas abiertas y se generan sus reportes.
          </p>
        </div>
      </div>

      {/* ── Master enable toggle ── */}
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="hm-section-icon hm-section-icon-master">
              <Power className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Cierre automático</h2>
              <p className="text-xs text-[var(--color-text-muted)]">
                Active o desactive por completo el cierre automático de cajas.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={config.enabled ? "success" : "neutral"}>
              {config.enabled ? "Activado" : "Desactivado"}
            </Badge>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => patch({ enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-full peer peer-checked:bg-[var(--color-master-600)] peer-checked:after:translate-x-5 after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
            </label>
          </div>
        </div>
      </Card>

      {/* ── Schedule per weekday group ── */}
      <Card>
        <div className="flex items-center gap-2.5 mb-4">
          <div className="hm-section-icon hm-section-icon-master">
            <CalendarClock className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Horarios de cierre</h2>
            <p className="text-[0.6875rem] text-[var(--color-text-muted)]">
              Hora local ({config.timezone}). Use el interruptor para deshabilitar un día.
            </p>
          </div>
        </div>

        <div>
          <DayTimeRow
            label="Lunes a Viernes"
            description="Hora estándar de cierre entre semana (predeterminado 5:30 PM)."
            value={config.weekdayCloseTime}
            onChange={(v) => patch({ weekdayCloseTime: v })}
            disabled={disabled}
          />
          <DayTimeRow
            label="Sábado"
            description="Hora de cierre los sábados."
            value={config.saturdayCloseTime}
            onChange={(v) => patch({ saturdayCloseTime: v })}
            disabled={disabled}
          />
          <DayTimeRow
            label="Domingo"
            description="Hora de cierre los domingos (normalmente sin cierre)."
            value={config.sundayCloseTime}
            onChange={(v) => patch({ sundayCloseTime: v })}
            disabled={disabled}
          />
        </div>
      </Card>

      {/* ── Timezone ── */}
      <Card>
        <div className="flex items-center gap-2.5 mb-4">
          <div className="hm-section-icon hm-section-icon-master">
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Zona horaria</h2>
            <p className="text-[0.6875rem] text-[var(--color-text-muted)]">
              Las horas configuradas se interpretan en esta zona horaria.
            </p>
          </div>
        </div>
        <select
          value={config.timezone}
          disabled={disabled}
          onChange={(e) => patch({ timezone: e.target.value })}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[var(--color-master-400)]"
        >
          {TIMEZONE_OPTIONS.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </Card>

      {/* ── Info note ── */}
      <div className="flex items-start gap-3 p-4 rounded-lg border-l-4 border-[var(--color-master-500)] bg-[var(--color-master-50)] text-[var(--color-master-700)]">
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <p className="text-sm">
          Al llegar la hora configurada, el sistema cierra todas las cajas que aún estén abiertas y deja sus reportes
          listos para revisión. El cierre se ejecuta de forma periódica, por lo que puede tomar algunos minutos después
          de la hora exacta.
        </p>
      </div>

      {/* ── Save ── */}
      <div className="flex justify-end">
        <Button onClick={handleSave} loading={saving} icon={<Save className="h-4 w-4" />}>
          Guardar configuración
        </Button>
      </div>
    </section>
  );
}
