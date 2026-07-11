"use client";

import { useState } from "react";
import { fmtC, fmtC0, fmtRatePct, type PayrollRates, DEFAULT_PAYROLL_RATES } from "./payroll-calc";

/**
 * Barra de composición del costo empresa (elemento firma de Planilla V2).
 *
 * Reutilizable en el hero (con brackets + leyenda interactiva) y en el drawer
 * (variante mini). Los segmentos suman exactamente el total recibido; estilos
 * en globals.css (`.pay-compbar`, tokens --pay-seg-*), correctos en light/dark.
 */

export type PayrollSegKey = "neto" | "ret" | "patronal" | "inatec" | "prov";

/** Montos por rubro: neto al empleado, retenciones (INSS+IR), cargas patronales. */
export type PayrollSegmentAmounts = Record<PayrollSegKey, number>;

export function segmentLabels(rates: PayrollRates = DEFAULT_PAYROLL_RATES): Record<PayrollSegKey, string> {
  return {
    neto: "Neto al empleado",
    ret: `Retenciones (INSS ${fmtRatePct(rates.inssLaboralRate)} + IR)`,
    patronal: `INSS patronal ${fmtRatePct(rates.inssPatronalRate)}`,
    inatec: `INATEC ${fmtRatePct(rates.inatecRate)}`,
    prov: "Provisiones",
  };
}

const SEG_ORDER: PayrollSegKey[] = ["neto", "ret", "patronal", "inatec", "prov"];

type Props = {
  amounts: PayrollSegmentAmounts;
  total: number;
  rates?: PayrollRates;
  /** Variante compacta (drawer): sin brackets ni leyenda. */
  mini?: boolean;
  /** Brackets superiores "Salario base" / "Cargas patronales" (solo variante completa). */
  brackets?: boolean;
};

export function PayrollCompositionBar({ amounts, total, rates = DEFAULT_PAYROLL_RATES, mini = false, brackets = true }: Props) {
  const [highlight, setHighlight] = useState<PayrollSegKey | null>(null);
  const labels = segmentLabels(rates);
  const pct = (k: PayrollSegKey) => (total > 0 ? (amounts[k] / total) * 100 : 0);
  const segs = SEG_ORDER.filter((k) => amounts[k] > 0.005);

  const basePct = pct("neto") + pct("ret");
  const baseAmount = amounts.neto + amounts.ret;

  return (
    <div>
      {!mini && brackets && total > 0 && (
        <div className="pay-brackets" aria-hidden="true">
          <div className="pay-bracket" style={{ width: `${basePct}%` }}>
            Salario base · {fmtC0(baseAmount)}
          </div>
          <div className="pay-bracket" style={{ width: `${100 - basePct}%` }}>
            Cargas patronales · {fmtC0(total - baseAmount)}
          </div>
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
