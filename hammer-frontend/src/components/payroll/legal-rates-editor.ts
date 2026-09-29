/**
 * prompt-nomina-config.md Fase 3.2 — lógica pura del editor de reformas
 * legales ("Registrar reforma", master/settings/payroll). La columna
 * "base" de la tabla IR se CALCULA, nunca se edita a mano — misma fórmula
 * que valida el backend (validateLegalRates, payroll-nicaragua.ts) — así
 * el error de tipeo en una base queda eliminado de raíz, no solo
 * detectado después. La conversión %↔tasa es la frontera entre cómo el
 * usuario piensa (7%) y cómo se guarda (0.07).
 */
import { round2 } from "@/components/finance/payroll-calc";

export type IrBracketDraft = { from: number; rate: number };

/**
 * base[0] = 0; base[i] = base[i-1] + (from[i]-from[i-1]) × rate[i-1] —
 * misma fórmula que valida el backend (la tolerancia de 0.01 vive ahí, acá
 * solo se calcula el valor "correcto").
 */
export function computeIrBases(brackets: IrBracketDraft[]): number[] {
  const bases: number[] = [];
  for (let i = 0; i < brackets.length; i++) {
    if (i === 0) {
      bases.push(0);
      continue;
    }
    const prev = brackets[i - 1];
    bases.push(round2(bases[i - 1] + (brackets[i].from - prev.from) * prev.rate));
  }
  return bases;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** 7 → 0.07 — lo que el usuario teclea vs. lo que se guarda (DECIMAL(6,4) en DB). */
export function percentToRate(percent: number): number {
  return round4(percent / 100);
}

/** 0.07 → 7 — para prellenar el input al editar/copiar una reforma existente. */
export function rateToPercent(rate: number): number {
  return round4(rate * 100);
}

/** Referencia de tres salarios para la vista previa de impacto del IR (mín./medio/alto). */
export const IR_PREVIEW_SALARIES = [15_000, 30_000, 60_000] as const;
