import type { ExpensePeriodBasis, PeriodKind } from "@/components/finance/expenses-period.types";

/**
 * prompt-gastos-semana-quincena.md Fase 3 — estado de navegación de
 * "Gastos por período" vive en la URL (?kind=&date=&branchId=&basis=) para
 * que sea compartible/refrescable, igual que el resto de Finanzas. Puro:
 * sin acceso a `window`/router, así se testea sin montar el componente.
 */
export type ExpensePeriodUrlState = {
  kind: PeriodKind;
  date: string | null;
  branchId: string | null;
  basis: ExpensePeriodBasis;
};

const VALID_KINDS: readonly PeriodKind[] = ["DAY", "WEEK", "QUINCENA", "MONTH", "CUSTOM"];

export function parsePeriodUrlState(params: URLSearchParams): ExpensePeriodUrlState {
  const rawKind = params.get("kind");
  const kind: PeriodKind = (VALID_KINDS as readonly string[]).includes(rawKind ?? "") ? (rawKind as PeriodKind) : "MONTH";
  const basis: ExpensePeriodBasis = params.get("basis") === "ACCRUED" ? "ACCRUED" : "PAID";
  return {
    kind,
    date: params.get("date"),
    branchId: params.get("branchId"),
    basis,
  };
}

/** Arma los query params para navegar a otro período, preservando branchId/basis salvo que se pasen explícitos. */
export function periodUrlParams(state: ExpensePeriodUrlState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("kind", state.kind);
  if (state.date) params.set("date", state.date);
  if (state.branchId) params.set("branchId", state.branchId);
  if (state.basis === "ACCRUED") params.set("basis", state.basis);
  return params;
}

/** YYYY-MM-DD en hora de Managua (operationalWindow ya ancla esa fecha a medianoche UTC-6, por eso leer en UTC es correcto acá). */
export function isoDateOnly(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}
