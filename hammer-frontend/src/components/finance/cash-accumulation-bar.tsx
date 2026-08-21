"use client";

import { AlertTriangle, Settings2, TrendingUp } from "lucide-react";
import { STATE_META, type CashPosition } from "@/components/navigation/cash-indicator-panel";

const fmt = (v: number) => `C$${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("es-NI", { weekday: "long", day: "2-digit", month: "short" });
}

const BAR_FILL_COLOR: Record<CashPosition["state"], string> = {
  CLEAR: "var(--color-border-strong)",
  IN_TRANSIT_ONLY: "var(--color-border-strong)",
  ACCUMULATING: "var(--color-info-500)",
  APPROACHING: "var(--color-warning-500)",
  READY: "var(--color-warning-600)",
  OVERDUE: "var(--color-warning-700)",
  CRITICAL: "var(--color-danger-600)",
};

/**
 * prompt-tesoreria-gasto-retenido-y-techo.md T-4 — la barra de acumulado
 * contra umbral y techo. Correcciones sobre el mockup, obligatorias:
 *
 * - El tránsito NO va en el riel del techo (mide efectivo en la sucursal;
 *   lo que ya salió al banco no está ahí) — va como stat aparte, fuera de
 *   la barra.
 * - El techo es thresholdAmount × 2 — el mismo valor que decide CRITICAL
 *   en computeCashIndicatorState (cash-monitor.ts) — derivado, no una
 *   columna nueva.
 * - Sin clamp al 100%: en CRITICAL el acumulado supera el techo y ese
 *   exceso tiene que verse. El eje se reescala (su máximo crece con el
 *   acumulado) en vez de recortar la barra a 100% de un techo fijo.
 * - Los 7 estados de CashIndicatorState, no uno.
 * - Sin política: ACCUMULATING neutro y projection null son a propósito
 *   (el backend no inventa un umbral que nadie fijó) — la barra va sin
 *   marcas, sin fecha proyectada, con una acción para configurarla.
 */
export function CashAccumulationBar({ position, configureHref }: { position: CashPosition; configureHref?: string }) {
  const meta = STATE_META[position.state];
  const hasPolicy = position.policy !== null;

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        borderColor: meta.tone === "critical" ? "var(--color-danger-200)" : meta.tone === "amber" ? "var(--color-warning-200)" : "var(--color-border)",
        background: meta.tone === "critical" ? "var(--color-danger-50)" : meta.tone === "amber" ? "var(--color-warning-50)" : "var(--color-surface)",
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {position.state === "CRITICAL" && <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--color-danger-600)]" aria-hidden="true" />}
          <span className="text-sm font-semibold text-[var(--color-text)]">{meta.label}</span>
        </div>
        <span className="font-mono text-base font-bold tabular-nums text-[var(--color-text)]">{fmt(position.accumulatedAmount)}</span>
      </div>

      {hasPolicy ? (
        <PolicyBar position={position} />
      ) : (
        <NoPolicyBar accumulatedAmount={position.accumulatedAmount} configureHref={configureHref} />
      )}

      {position.inTransitAmount > 0.01 && (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          <TrendingUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>En tránsito (ya salió de la sucursal, no cuenta para el techo): <span className="font-semibold tabular-nums">{fmt(position.inTransitAmount)}</span></span>
        </div>
      )}

      {position.projection && (position.projection.likelyDate || position.projection.earliestDate) && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          Proyección: llegaría al umbral{" "}
          {position.projection.likelyDate ? <span className="font-semibold">{fmtDate(position.projection.likelyDate)}</span> : "sin fecha estimable"}
          {position.projection.confidence === "LOW" ? " (baja confianza, poco historial)" : ""}
        </p>
      )}

      {position.anomaly && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--color-warning-700)]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {position.anomaly.message}
        </p>
      )}
    </div>
  );
}

function NoPolicyBar({ accumulatedAmount, configureHref }: { accumulatedAmount: number; configureHref?: string }) {
  return (
    <div>
      <div
        role="progressbar"
        aria-valuenow={accumulatedAmount}
        aria-valuemin={0}
        aria-valuemax={accumulatedAmount || 1}
        aria-valuetext={`${fmt(accumulatedAmount)} acumulado, sin política de depósito configurada`}
        className="h-3 w-full overflow-hidden rounded-full bg-[var(--color-surface-alt)]"
      >
        <div className="h-full rounded-full" style={{ width: accumulatedAmount > 0 ? "100%" : "0%", background: "var(--color-border-strong)" }} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--color-text-muted)]">Sin política de depósito configurada — sin umbral ni techo que mostrar.</p>
        {configureHref && (
          <a href={configureHref} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--color-master-600)] hover:underline">
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
            Configurar
          </a>
        )}
      </div>
    </div>
  );
}

function PolicyBar({ position }: { position: CashPosition }) {
  const threshold = position.policy!.thresholdAmount;
  const ceiling = threshold * 2;
  const accumulated = position.accumulatedAmount;

  // Reescala el eje cuando el acumulado supera el techo — nunca lo
  // recorta a 100%. axisMax siempre >= ceiling, y crece con accumulated.
  const axisMax = Math.max(ceiling, accumulated) * (accumulated > ceiling ? 1.08 : 1);
  const pct = (value: number) => Math.min(100, (value / axisMax) * 100);
  const overflowPercent = accumulated > ceiling ? Math.round(((accumulated - ceiling) / ceiling) * 100) : 0;

  return (
    <div>
      <div
        role="progressbar"
        aria-valuenow={accumulated}
        aria-valuemin={0}
        aria-valuemax={ceiling}
        aria-valuetext={`${fmt(accumulated)} de ${fmt(threshold)} de umbral, techo ${fmt(ceiling)}${overflowPercent > 0 ? `, ${overflowPercent}% sobre el techo` : ""}`}
        className="relative h-3 w-full overflow-hidden rounded-full bg-[var(--color-surface-alt)]"
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${pct(accumulated)}%`, background: BAR_FILL_COLOR[position.state] }}
        />
        {/* Marca del umbral (100% = READY) */}
        <div className="absolute inset-y-0 w-px bg-[var(--color-text-soft)]" style={{ left: `${pct(threshold)}%` }} aria-hidden="true" />
        {/* Marca del techo (200% = CRITICAL) */}
        <div className="absolute inset-y-0 w-px bg-[var(--color-danger-400)]" style={{ left: `${pct(ceiling)}%` }} aria-hidden="true" />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--color-text-soft)]">
        <span>C$0</span>
        <span>Umbral {fmt(threshold)}</span>
        <span>Techo {fmt(ceiling)}</span>
      </div>
      {overflowPercent > 0 && (
        <p className="mt-1.5 text-xs font-semibold text-[var(--color-danger-600)]">
          {overflowPercent}% sobre el techo — {fmt(accumulated - ceiling)} de exceso.
        </p>
      )}
      {position.policy!.maxDaysHolding > 0 && (
        <p className="mt-1 text-[0.6875rem] text-[var(--color-text-soft)]">Máximo {position.policy!.maxDaysHolding} día(s) hábiles reteniendo.</p>
      )}
    </div>
  );
}
