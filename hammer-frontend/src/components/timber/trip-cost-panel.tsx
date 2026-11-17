"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { numFixed as fmt } from "@/lib/format";
import { EXPENSE_FIELDS, liveTripCost, pct, type CostMode, type Expenses, type Reconciliation, type TripLineDraft } from "./trip-logic";

export type TripCostForm = {
  supplierName: string;
  origin: string;
  costMode: CostMode;
  costPerFoot: number | "";
  woodTripTotalCost: number | "";
  expenses: Expenses;
  invoicedFeet: number | "";
};

const labelClass = "block text-[11.5px] font-semibold text-[var(--color-text-muted)]";
const inputClass = "mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] disabled:opacity-70";
const numberValue = (v: string): number | "" => (v === "" ? "" : Math.max(0, Number(v) || 0));

/** Datos del viaje, costo de la madera, gastos (aserrado aparte) y pies de la factura. */
export function TripCostPanel({ form, setForm, lines, reconciliation, isEditable }: {
  form: TripCostForm;
  setForm: (patch: Partial<TripCostForm>) => void;
  lines: TripLineDraft[];
  reconciliation: Reconciliation;
  isEditable: boolean;
}) {
  const cost = liveTripCost({
    lines,
    costMode: form.costMode,
    costPerFoot: Number(form.costPerFoot) || 0,
    woodTripTotalCost: Number(form.woodTripTotalCost) || 0,
    expenses: form.expenses,
  });
  const noCost = cost.woodTotal <= 0;

  return (
    <div className="flex flex-col gap-3.5">
      <Card>
        <div className="hm-section-rule">Datos del viaje</div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className={labelClass}>Proveedor<input disabled={!isEditable} value={form.supplierName} onChange={(e) => setForm({ supplierName: e.target.value })} className={inputClass} /></label>
          <label className={labelClass}>Origen<input disabled={!isEditable} value={form.origin} onChange={(e) => setForm({ origin: e.target.value })} className={inputClass} /></label>
        </div>
      </Card>

      <Card>
        <div className="hm-section-rule">Costo de la madera</div>
        <div role="radiogroup" aria-label="Cómo se escribe el costo" className="mb-2.5 flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-0.5">
          {([["PER_FOOT", "Precio por pie"], ["TOTAL", "Total del viaje"]] as const).map(([mode, label]) => (
            <button key={mode} type="button" role="radio" aria-checked={form.costMode === mode} disabled={!isEditable} onClick={() => setForm({ costMode: mode })} className={`flex-1 rounded-md py-2 text-[12.5px] font-semibold ${form.costMode === mode ? "bg-[var(--color-surface)] text-[var(--color-master-700)] shadow-sm" : "text-[var(--color-text-muted)]"}`}>
              {label}
            </button>
          ))}
        </div>
        {form.costMode === "PER_FOOT" ? (
          <label className={labelClass}>Precio por pie tablar (C$)
            <input disabled={!isEditable} type="number" inputMode="decimal" min={0} step="0.01" value={form.costPerFoot} onChange={(e) => setForm({ costPerFoot: numberValue(e.target.value) })} className={`${inputClass} text-right font-mono`} />
          </label>
        ) : (
          <label className={labelClass}>Costo total de la madera, sin aserrado ni gastos (C$)
            <input disabled={!isEditable} type="number" inputMode="decimal" min={0} step="0.01" value={form.woodTripTotalCost} onChange={(e) => setForm({ woodTripTotalCost: numberValue(e.target.value) })} className={`${inputClass} text-right font-mono`} />
          </label>
        )}
        <div className="mt-2.5 flex justify-between text-[12.5px]"><span className="text-[var(--color-text-muted)]">Madera ({fmt(cost.totalFeet)} pies × {fmt(cost.costPerFoot)})</span><b>C$ {fmt(cost.woodTotal)}</b></div>
        {noCost && isEditable && <p className="mt-1.5 text-[12px] text-[var(--color-warning-800)]">Sin costo de la madera no se puede ingresar el viaje.</p>}
      </Card>

      <Card>
        <div className="hm-section-rule">Aserrado y gastos del viaje</div>
        <div className="grid grid-cols-2 gap-2.5">
          {EXPENSE_FIELDS.map(([label, key]) => (
            <label key={key} className="block text-[11px] font-semibold text-[var(--color-text-muted)]">
              {label}
              <input disabled={!isEditable} type="number" inputMode="decimal" min={0} step="0.01" placeholder="0" value={form.expenses[key] || ""} onChange={(e) => setForm({ expenses: { ...form.expenses, [key]: Number(numberValue(e.target.value)) || 0 } })} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-right font-mono text-[12.5px] disabled:opacity-70" />
            </label>
          ))}
        </div>
        <div className="mt-2.5 flex justify-between border-t border-[var(--color-border)] pt-2 text-[12.5px]"><span className="text-[var(--color-text-muted)]">Total aserrado y gastos</span><b>C$ {fmt(cost.expensesTotal)}</b></div>
        <div className="flex justify-between text-[12.5px]"><span className="text-[var(--color-text-muted)]">Costo final por pie (madera + gastos)</span><b className="font-mono">C$ {fmt(cost.landedCostPerFoot, 4)}</b></div>
      </Card>

      <Card>
        <div className="hm-section-rule">Factura del aserradero</div>
        <label className={labelClass}>Pies según la factura (opcional)
          <input disabled={!isEditable} type="number" inputMode="decimal" min={0} step="0.01" value={form.invoicedFeet} onChange={(e) => setForm({ invoicedFeet: numberValue(e.target.value) })} className={`${inputClass} text-right font-mono`} />
        </label>
        {reconciliation.status !== "NOT_APPLICABLE" && (
          <>
            <div className="mt-2 flex justify-between text-[12.5px]"><span className="text-[var(--color-text-muted)]">Diferencia con lo cubicado</span><b>{fmt(reconciliation.differenceFeet)} pies ({pct(reconciliation.differencePercent, 2)})</b></div>
            <div className="mt-1.5">{reconciliation.status === "OK" ? <Badge variant="success">Cuadra con la factura</Badge> : <Badge variant="warning">No cuadra: te lo vamos a pedir al ingresar</Badge>}</div>
          </>
        )}
      </Card>
    </div>
  );
}
