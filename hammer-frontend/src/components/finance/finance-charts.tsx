"use client";

import type { ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { money } from "@/lib/format";
import {
  axisMoney, niceCeil, buildBranchProfitRows, buildExpenseMix, buildPnlWaterfall,
  type BranchProfitRow, type PnlForWaterfall, type WaterfallStep,
} from "./finance-chart-data";

/*
 * Gráficas del Resumen de Finanzas. Colores por rol en .fin-viz (globals.css),
 * paleta validada contra el fondo claro (#fff) y oscuro (#232120). Reglas:
 * un solo eje, marcas delgadas, rejilla de línea fina, leyenda con 2+ series,
 * y cada gráfica tiene su tabla (el estado de resultados, la tabla por
 * sucursal, o "Ver en tabla") para no depender del color ni del tooltip.
 */

const AXIS_TICK = { fontSize: 11, fill: "var(--color-text-muted)" };
const GRID_STROKE = "var(--color-border)";

/* ── piezas compartidas ── */

function ChartCard({ title, subtitle, legend, children, footer }: { title: string; subtitle?: string; legend?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="fin-viz min-w-0 rounded-xl p-4 space-y-3" style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{title}</h3>
          {subtitle && <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{subtitle}</p>}
        </div>
        {legend}
      </div>
      {children}
      {footer}
    </section>
  );
}

type LegendItem = { label: string; color: string; shape?: "rect" | "line" };
function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--color-text-secondary)" }}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          {i.shape === "line"
            ? <span aria-hidden className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: i.color }} />
            : <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Tooltip: el valor manda (fuerte), el nombre de la serie después, con una rayita de su color. */
function TooltipBox({ title, rows }: { title?: string; rows: Array<{ label: string; value: string; color?: string }> }) {
  return (
    <div className="rounded-lg px-3 py-2 text-xs shadow-md" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
      {title && <p className="mb-1 font-medium" style={{ color: "var(--color-text-muted)" }}>{title}</p>}
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            {r.color && <span aria-hidden className="inline-block h-0.5 w-3 rounded-full" style={{ background: r.color }} />}
            <b className="tabular-nums" style={{ color: "var(--color-text)" }}>{r.value}</b>
            <span style={{ color: "var(--color-text-secondary)" }}>{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Ver en tabla": el equivalente sin color de cada gráfica. */
function TableView({ head, rows }: { head: string[]; rows: Array<Array<string>> }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer select-none font-medium" style={{ color: "var(--color-text-secondary)" }}>Ver en tabla</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[420px] text-left">
          <thead>
            <tr style={{ color: "var(--color-text-muted)" }}>
              {head.map((h, i) => <th key={h} className={`py-1 pr-3 font-medium ${i > 0 ? "text-right" : ""}`}>{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
            {rows.map((r) => (
              <tr key={r[0]}>
                {r.map((c, i) => <td key={i} className={`py-1 pr-3 tabular-nums ${i > 0 ? "text-right" : ""}`} style={{ color: i === 0 ? "var(--color-text)" : "var(--color-text-secondary)" }}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// recharts entrega el tooltip con tipos genéricos; aquí solo se lee lo necesario.
type TipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown; value?: unknown; dataKey?: unknown }>; label?: unknown };

/* ── 1. Cascada: de las ventas a la utilidad ── */

const WATERFALL_COLOR: Record<WaterfallStep["kind"], string> = {
  total: "var(--viz-total)",
  up: "var(--viz-up)",
  down: "var(--viz-down)",
};

export function PnlWaterfallChart({ pnl }: { pnl: PnlForWaterfall }) {
  const steps = buildPnlWaterfall(pnl);
  const height = steps.length * 34 + 36;
  return (
    <ChartCard
      title="De las ventas a la utilidad"
      subtitle="Cada barra es un paso del estado de resultados del mes"
      legend={<Legend items={[{ label: "Total", color: WATERFALL_COLOR.total }, { label: "Resta", color: WATERFALL_COLOR.down }, { label: "Suma", color: WATERFALL_COLOR.up }]} />}
    >
      <div style={{ height }} role="img" aria-label={`Cascada del estado de resultados: ${steps.map((s) => `${s.label} ${money(s.amount)}`).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={steps} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 0 }} barCategoryGap={6}>
            <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
            <XAxis type="number" tick={AXIS_TICK} tickFormatter={axisMoney} axisLine={false} tickLine={false}
              domain={[(min: number) => Math.min(0, -niceCeil(-min)), (max: number) => niceCeil(max)]} />
            <YAxis type="category" dataKey="label" width={140} tick={{ ...AXIS_TICK, fill: "var(--color-text-secondary)" }} axisLine={false} tickLine={false} interval={0} />
            <ReferenceLine x={0} stroke="var(--color-border-strong)" />
            <Tooltip
              cursor={{ fill: "var(--color-surface-alt)" }}
              content={({ active, payload }: TipProps) => {
                const step = active ? (payload?.[0]?.payload as WaterfallStep | undefined) : undefined;
                if (!step) return null;
                const verb = step.kind === "total" ? "" : step.kind === "down" ? "resta " : "suma ";
                return <TooltipBox title={step.label} rows={[{ label: step.kind === "total" ? "total" : verb.trim(), value: money(Math.abs(step.amount)), color: WATERFALL_COLOR[step.kind] }]} />;
              }}
            />
            <Bar dataKey="range" maxBarSize={22} radius={4} isAnimationActive={false}>
              {steps.map((s) => <Cell key={s.label} fill={WATERFALL_COLOR[s.kind]} />)}
              {/* Solo los totales llevan su número: los pasos están en el estado de resultados de al lado. */}
              <LabelList
                dataKey="range"
                content={(props) => {
                  const { x, y, width, height: h, index } = props as { x?: number; y?: number; width?: number; height?: number; index?: number };
                  const step = index != null ? steps[index] : undefined;
                  if (!step || step.kind !== "total" || x == null || y == null || width == null || h == null) return null;
                  return (
                    <text x={Number(x) + Number(width) + 6} y={Number(y) + Number(h) / 2} dominantBaseline="central" fontSize={11} fontWeight={600} fill="var(--color-text)">
                      {axisMoney(step.amount)}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/* ── 2. Utilidad por sucursal ── */

export function BranchProfitChart({
  byBranch, centralExpenses,
}: { byBranch: Array<{ branchCode: string | null; branchName: string | null; operatingProfit: number }>; centralExpenses: number }) {
  const rows = buildBranchProfitRows(byBranch, centralExpenses);
  if (rows.length < 2) return null; // una sola barra no es gráfica: el número ya está en el estado de resultados
  const height = rows.length * 36 + 36;
  return (
    <ChartCard
      title="Utilidad operativa por sucursal"
      subtitle={centralExpenses > 0 ? "Central = gastos sin sucursal (banco central, comisión de tarjeta)" : "Del mes, ya con sus gastos"}
      legend={<Legend items={[{ label: "Gana", color: "var(--viz-up)" }, { label: "Pierde", color: "var(--viz-down)" }]} />}
    >
      <div style={{ height }} role="img" aria-label={`Utilidad por sucursal: ${rows.map((r) => `${r.label} ${money(r.profit)}`).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 0 }} barCategoryGap={8}>
            <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
            <XAxis type="number" tick={AXIS_TICK} tickFormatter={axisMoney} axisLine={false} tickLine={false}
              domain={[(min: number) => Math.min(0, -niceCeil(-min)), (max: number) => niceCeil(max)]} />
            <YAxis type="category" dataKey="label" width={72} tick={{ ...AXIS_TICK, fill: "var(--color-text-secondary)" }} axisLine={false} tickLine={false} interval={0} />
            <ReferenceLine x={0} stroke="var(--color-border-strong)" />
            <Tooltip
              cursor={{ fill: "var(--color-surface-alt)" }}
              content={({ active, payload }: TipProps) => {
                const row = active ? (payload?.[0]?.payload as BranchProfitRow | undefined) : undefined;
                if (!row) return null;
                return <TooltipBox title={row.label} rows={[{ label: row.central ? "gastos sin sucursal" : "utilidad operativa", value: money(row.profit), color: row.profit >= 0 ? "var(--viz-up)" : "var(--viz-down)" }]} />;
              }}
            />
            <Bar dataKey="profit" maxBarSize={22} radius={4} isAnimationActive={false}>
              {rows.map((r) => <Cell key={r.label} fill={r.profit >= 0 ? "var(--viz-up)" : "var(--viz-down)"} />)}
              <LabelList dataKey="profit" position="right" formatter={(v: unknown) => axisMoney(Number(v))} fontSize={11} fill="var(--color-text-secondary)" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/* ── 3. Trayectoria: ingresos y utilidad, 6 meses ── */

export type TrendChartPoint = {
  label: string;
  netSales: number;
  operatingProfit: number;
  payrollPaid: number;
  cashExpenses: number;
  bankExpenses: number;
  retainedCashExpenses: number;
  cardFees?: number;
};

/** Un panel de la trayectoria: una sola serie, su propio eje (no se mezclan escalas). */
function TrendPanel({
  points, dataKey, title, signed = false, syncId,
}: { points: TrendChartPoint[]; dataKey: "netSales" | "operatingProfit"; title: string; signed?: boolean; syncId: string }) {
  const color = (v: number) => (!signed ? "var(--viz-1)" : v >= 0 ? "var(--viz-up)" : "var(--viz-down)");
  const lastIndex = points.length - 1;
  return (
    <div>
      <p className="mb-1 text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>{title}</p>
      <div className="h-36" role="img" aria-label={`${title} por mes: ${points.map((p) => `${p.label} ${money(p[dataKey])}`).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} syncId={syncId} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: "var(--color-border-strong)" }} tickLine={false} />
            <YAxis tick={AXIS_TICK} tickFormatter={axisMoney} width={48} axisLine={false} tickLine={false} tickCount={4} />
            {signed && <ReferenceLine y={0} stroke="var(--color-border-strong)" />}
            <Tooltip
              cursor={{ fill: "var(--color-surface-alt)" }}
              content={({ active, payload, label }: TipProps) => {
                const p = active ? (payload?.[0]?.payload as TrendChartPoint | undefined) : undefined;
                if (!p) return null;
                const margin = p.netSales > 0 ? `${((p.operatingProfit / p.netSales) * 100).toFixed(1)}%` : "—";
                return (
                  <TooltipBox
                    title={String(label ?? p.label)}
                    rows={[
                      { label: "ventas netas", value: money(p.netSales), color: "var(--viz-1)" },
                      { label: "utilidad operativa", value: money(p.operatingProfit), color: color(p.operatingProfit) },
                      { label: "margen", value: margin },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey={dataKey} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {points.map((p) => <Cell key={p.label} fill={color(p[dataKey])} />)}
              {/* Solo el último mes lleva su número; el resto, en el eje, el tooltip y "Ver en tabla". */}
              <LabelList
                dataKey={dataKey}
                content={(props) => {
                  const { x, y, width, index } = props as { x?: number; y?: number; width?: number; index?: number };
                  if (index !== lastIndex || x == null || y == null || width == null) return null;
                  return (
                    <text x={Number(x) + Number(width) / 2} y={Number(y) - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--color-text)">
                      {axisMoney(points[lastIndex][dataKey])}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Ventas y utilidad, 6 meses: dos paneles alineados (la utilidad es ~10 veces menor y en un eje común quedaba plana). */
export function SalesProfitTrendChart({ points }: { points: TrendChartPoint[] }) {
  return (
    <ChartCard
      title="Ingresos y utilidad, últimos 6 meses"
      subtitle="Real, base caja. El mes en curso va parcial hasta cerrarlo."
      footer={<TableView head={["Mes", "Ventas netas", "Utilidad operativa", "Margen"]} rows={points.map((p) => [p.label, money(p.netSales), money(p.operatingProfit), p.netSales > 0 ? `${((p.operatingProfit / p.netSales) * 100).toFixed(1)}%` : "—"])} />}
    >
      <div className="space-y-3">
        <TrendPanel points={points} dataKey="netSales" title="Ventas netas" syncId="fin-trend" />
        <TrendPanel points={points} dataKey="operatingProfit" title="Utilidad operativa" signed syncId="fin-trend" />
      </div>
    </ChartCard>
  );
}

/* ── 4. A dónde se va la plata: gastos por mes ── */

const MIX_SERIES = [
  { key: "payroll", label: "Planilla", color: "var(--viz-1)" },
  { key: "operating", label: "Gastos (caja, banco, retenido)", color: "var(--viz-2)" },
  { key: "cardFees", label: "Comisión de tarjeta", color: "var(--viz-3)" },
] as const;

export function ExpenseMixChart({ points }: { points: TrendChartPoint[] }) {
  const data = buildExpenseMix(points);
  if (!data.some((d) => d.total > 0)) return null;
  return (
    <ChartCard
      title="A dónde se va la plata"
      subtitle="Gastos reales pagados por mes"
      legend={<Legend items={MIX_SERIES.map((s) => ({ label: s.label, color: s.color }))} />}
      footer={<TableView head={["Mes", ...MIX_SERIES.map((s) => s.label), "Total"]} rows={data.map((d) => [d.label, money(d.payroll), money(d.operating), money(d.cardFees), money(d.total)])} />}
    >
      <div className="h-64" role="img" aria-label="Gastos reales por mes: planilla, gastos y comisión de tarjeta">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: "var(--color-border-strong)" }} tickLine={false} />
            <YAxis tick={AXIS_TICK} tickFormatter={axisMoney} width={48} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "var(--color-surface-alt)" }}
              content={({ active, payload, label }: TipProps) => {
                const d = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                if (!d) return null;
                return (
                  <TooltipBox
                    title={`${String(label ?? d.label)} · ${money(d.total)}`}
                    rows={[...MIX_SERIES].reverse().map((s) => ({ label: s.label.toLowerCase(), value: money(d[s.key]), color: s.color }))}
                  />
                );
              }}
            />
            {/* Separación de 2px del color del fondo entre segmentos (no un borde). */}
            {MIX_SERIES.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId="gastos" fill={s.color} stroke="var(--color-surface)" strokeWidth={2}
                maxBarSize={24} radius={i === MIX_SERIES.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/* ── 5. Tendencia mínima para las tarjetas del resumen ejecutivo ── */

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const data = values.map((v, i) => ({ i, v }));
  const last = data.length - 1;
  return (
    <div className="fin-viz mt-1.5 h-8 w-full max-w-[160px]" role="img" aria-label={`${label}: tendencia de ${values.length} meses`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line dataKey="v" stroke="var(--viz-muted)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; index?: number }) =>
              props.index === last && props.cx != null && props.cy != null
                ? <circle key="last" cx={props.cx} cy={props.cy} r={4} fill="var(--viz-1)" stroke="var(--color-surface)" strokeWidth={2} />
                : <g key={`d${props.index}`} />}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
