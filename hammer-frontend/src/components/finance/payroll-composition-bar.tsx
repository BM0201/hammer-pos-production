"use client";

import { useState } from "react";
import { fmtC, fmtC0, fmtRatePct, resolveInssRates, type PayrollRates, DEFAULT_PAYROLL_RATES } from "./payroll-calc";

/**
 * Barra de composición del costo empresa (elemento firma de Planilla V2).
 *
 * Reutilizable en el hero (con brackets + leyenda interactiva) y en el drawer
 * (variante mini). Los segmentos suman exactamente el total recibido; estilos
 * en globals.css (`.pay-compbar`, tokens --pay-seg-*), correctos en light/dark.
 *
 * Las prestaciones sociales van DESGLOSADAS en tres segmentos (aguinaldo,
 * vacaciones, indemnización) en tonos violeta/rosa: son obligaciones legales
 * distintas, con acumulación y tratamiento fiscal propios.
 */

export type PayrollSegKey = "neto" | "ret" | "patronal" | "inatec" | "agui" | "vac" | "indem";

/** Montos por rubro: neto, retenciones (INSS+IR), cargas y las tres prestaciones. */
export type PayrollSegmentAmounts = Record<PayrollSegKey, number>;

export function segmentLabels(rates: PayrollRates = DEFAULT_PAYROLL_RATES): Record<PayrollSegKey, string> {
  const inss = resolveInssRates(rates.inssRegime, rates.activeEmployeeCount);
  return {
    neto: "Neto al empleado",
    ret: `Retenciones (INSS ${fmtRatePct(inss.laboral)} + IR)`,
    patronal: `INSS patronal ${fmtRatePct(inss.patronal)}`,
    inatec: `INATEC ${fmtRatePct(rates.inatecRate)}`,
    agui: "Aguinaldo (1/12)",
    vac: "Vacaciones (2.5 días/mes)",
    indem: "Indemnización Art. 45 (según antigüedad)",
  };
}

const SEG_ORDER: PayrollSegKey[] = ["neto", "ret", "patronal", "inatec", "agui", "vac", "indem"];

type Props = {
  amounts: PayrollSegmentAmounts;
  total: number;
  rates?: PayrollRates;
  /** Variante compacta (drawer): sin brackets ni leyenda. */
  mini?: boolean;
  /** Brackets superiores "Salario base" / "INSS + INATEC" / "Prestaciones sociales". */
  brackets?: boolean;
};

export function PayrollCompositionBar({ amounts, total, rates = DEFAULT_PAYROLL_RATES, mini = false, brackets = true }: Props) {
  const [highlight, setHighlight] = useState<PayrollSegKey | null>(null);
  const labels = segmentLabels(rates);
  const pct = (k: PayrollSegKey) => (total > 0 ? (amounts[k] / total) * 100 : 0);
  const segs = SEG_ORDER.filter((k) => amounts[k] > 0.005);

  const basePct = pct("neto") + pct("ret");
  const baseAmount = amounts.neto + amounts.ret;
  const cargasPct = pct("patronal") + pct("inatec");
  const cargasAmount = amounts.patronal + amounts.inatec;
  const prestacionesAmount = amounts.agui + amounts.vac + amounts.indem;
  const prestacionesPct = pct("agui") + pct("vac") + pct("indem");

  return (
    <div>
      {!mini && brackets && total > 0 && (
        <div className="pay-brackets" aria-hidden="true">
          <div className="pay-bracket" style={{ width: `${basePct}%` }}>
            Salario base · {fmtC0(baseAmount)}
          </div>
          <div className="pay-bracket" style={{ width: `${cargasPct}%` }}>
            INSS + INATEC · {fmtC0(cargasAmount)}
          </div>
          {prestacionesAmount > 0.005 && (
            <div className="pay-bracket" style={{ width: `${prestacionesPct}%` }}>
              Prestaciones sociales · {fmtC0(prestacionesAmount)}
            </div>
          )}
        </div>
      )}

      <div
        className={mini ? "pay-compbar-mini" : "pay-compbar"}
        data-hl={highlight ?? undefined}
        role="img"
        aria-label="Composición del costo total de la planilla"
      >
        {segs.map((k, i) => (
          <div
            key={k}
            className={`pay-seg pay-seg-${k}`}
            data-seg={k}
            style={{ width: `${pct(k)}%`, animationDelay: `${i * 45}ms` }}
            title={`${labels[k]}: ${fmtC(amounts[k])} (${pct(k).toFixed(1)}%)`}
          />
        ))}
      </div>

      {!mini && (
        <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1.5">
          {segs.map((k) => (
            <span
              key={k}
              tabIndex={0}
              className="inline-flex items-baseline gap-1.5 rounded-lg border border-transparent px-2.5 py-1 text-xs transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] focus-visible:border-[var(--color-border)] focus-visible:bg-[var(--color-surface-alt)]"
              onMouseEnter={() => setHighlight(k)}
              onMouseLeave={() => setHighlight(null)}
              onFocus={() => setHighlight(k)}
              onBlur={() => setHighlight(null)}
            >
              <span className="h-[9px] w-[9px] self-center rounded-[3px]" style={{ background: `var(--pay-seg-${k})` }} />
              <span className="font-medium text-[var(--color-text-secondary)]">{labels[k]}</span>
              <span className="font-bold tabular-nums text-[var(--color-text)]">{fmtC(amounts[k])}</span>
              <span className="text-[0.6563rem] tabular-nums text-[var(--color-text-soft)]">{pct(k).toFixed(1)}%</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
