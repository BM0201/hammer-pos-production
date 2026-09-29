"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { X, Check, Plus, Trash2 } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money } from "@/lib/format";
import { computeAnnualIr, round2, type LegalRates } from "@/components/finance/payroll-calc";
import { computeIrBases, percentToRate, rateToPercent, IR_PREVIEW_SALARIES, type IrBracketDraft } from "./legal-rates-editor";

/**
 * prompt-nomina-config.md Fase 3.2 — "Registrar reforma": formulario
 * prellenado con lo vigente. Las 6 tasas INSS se ingresan como PORCENTAJE
 * (7 → 0.07), se convierten solo al enviar. La columna `base` de la tabla
 * IR se calcula sola — no se puede editar — así el error de tipeo en una
 * base queda eliminado de raíz.
 */

const RATE_FIELDS: { key: keyof Pick<LegalRates, "inssIntegralLaboral" | "inssIntegralPatronalLt50" | "inssIntegralPatronalGte50" | "inssIvmRpLaboral" | "inssIvmRpPatronalLt50" | "inssIvmRpPatronalGte50">; label: string }[] = [
  { key: "inssIntegralLaboral", label: "INSS laboral (Integral)" },
  { key: "inssIntegralPatronalLt50", label: "INSS patronal Integral, empresa <50" },
  { key: "inssIntegralPatronalGte50", label: "INSS patronal Integral, empresa ≥50" },
  { key: "inssIvmRpLaboral", label: "INSS laboral (IVM-RP)" },
  { key: "inssIvmRpPatronalLt50", label: "INSS patronal IVM-RP, empresa <50" },
  { key: "inssIvmRpPatronalGte50", label: "INSS patronal IVM-RP, empresa ≥50" },
];

const ERROR_MESSAGES: Record<string, string> = {
  LEGAL_RATES_PERIOD_ALREADY_POSTED: "Ya hay una planilla posteada en ese mes o en uno posterior — una reforma retroactiva sobre meses cerrados no se hace desde acá.",
  LEGAL_RATES_VERSION_EXISTS: "Ya existe una versión para ese mes. Para corregirla, eliminala del historial y creá una nueva.",
};

function nextMonthValue(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

function fmtMonthValue(value: string): string {
  const d = new Date(`${value}-01T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return value;
  const MES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${MES_LARGO[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function LegalRateVersionForm({
  current,
  onClose,
  onCreated,
}: {
  current: LegalRates;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [percents, setPercents] = useState<Record<string, string>>(() =>
    Object.fromEntries(RATE_FIELDS.map(({ key }) => [key, String(rateToPercent(current[key]))])),
  );
  const [inatecPercent, setInatecPercent] = useState(String(rateToPercent(current.inatecRate)));
  const [threshold, setThreshold] = useState(String(current.inssEmployerSizeThreshold));
  const [legalBasis, setLegalBasis] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(nextMonthValue());
  const [brackets, setBrackets] = useState<IrBracketDraft[]>(current.irTableAnnual.map((b) => ({ from: b.from, rate: b.rate })));
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const bases = computeIrBases(brackets);

  function addBracket() {
    setBrackets((b) => [...b, { from: 0, rate: 0 }]);
  }
  function removeBracket(index: number) {
    setBrackets((b) => b.filter((_, i) => i !== index));
  }
  function updateBracket(index: number, field: keyof IrBracketDraft, value: number) {
    setBrackets((b) => b.map((br, i) => (i === index ? { ...br, [field]: value } : br)));
  }

  const newLegal: LegalRates = {
    inssIntegralLaboral: percentToRate(Number(percents.inssIntegralLaboral) || 0),
    inssIntegralPatronalLt50: percentToRate(Number(percents.inssIntegralPatronalLt50) || 0),
    inssIntegralPatronalGte50: percentToRate(Number(percents.inssIntegralPatronalGte50) || 0),
    inssIvmRpLaboral: percentToRate(Number(percents.inssIvmRpLaboral) || 0),
    inssIvmRpPatronalLt50: percentToRate(Number(percents.inssIvmRpPatronalLt50) || 0),
    inssIvmRpPatronalGte50: percentToRate(Number(percents.inssIvmRpPatronalGte50) || 0),
    inssEmployerSizeThreshold: Number(threshold) || 0,
    inatecRate: percentToRate(Number(inatecPercent) || 0),
    irTableAnnual: brackets.map((b, i) => ({ from: b.from, rate: b.rate, base: bases[i] ?? 0 })),
  };

  const canConfirm = Boolean(effectiveFrom) && legalBasis.trim().length >= 3 && brackets.length > 0;

  async function submit() {
    if (!canConfirm) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/payroll/legal-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effectiveFrom: `${effectiveFrom}-01`,
          ...newLegal,
          legalBasis: legalBasis.trim(),
        }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) {
        const code = raw?.error?.code as string | undefined;
        const details = raw?.error?.details as { errors?: string[] } | undefined;
        if (details?.errors?.length) throw new Error(details.errors.join(" "));
        throw new Error((code && ERROR_MESSAGES[code]) || raw?.error?.message || "No se pudo registrar la reforma.");
      }
      const version = unwrapApiData(raw) as { effectiveFrom: string };
      toast.success(`Reforma registrada — rige desde ${fmtMonthValue(version.effectiveFrom.slice(0, 7))}.`);
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar la reforma.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto space-y-5 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Registrar reforma legal</h3>
          <button type="button" onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-[var(--color-text-muted)]">
            Mes de vigencia
            <input type="month" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="hm-input mt-1 w-full" />
          </label>
          <label className="text-xs font-semibold text-[var(--color-text-muted)]">
            Base legal
            <input value={legalBasis} onChange={(e) => setLegalBasis(e.target.value)} placeholder='Ej. "Decreto 06-2019"' className="hm-input mt-1 w-full" />
          </label>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-[var(--color-text-muted)]">Tasas INSS (%)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {RATE_FIELDS.map(({ key, label }) => (
              <label key={key} className="text-xs text-[var(--color-text-secondary)]">
                {label}
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={99}
                  value={percents[key]}
                  onChange={(e) => setPercents((p) => ({ ...p, [key]: e.target.value }))}
                  className="hm-input mt-1 w-full"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[var(--color-text-secondary)]">
              INATEC (%)
              <input type="number" step="0.01" min={0} max={99} value={inatecPercent} onChange={(e) => setInatecPercent(e.target.value)} className="hm-input mt-1 w-full" />
            </label>
            <label className="text-xs text-[var(--color-text-secondary)]">
              Umbral de tamaño de empresa
              <input type="number" step="1" min={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} className="hm-input mt-1 w-full" />
            </label>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-[var(--color-text-muted)]">Tabla IR anual — la base se calcula sola</p>
            <button type="button" onClick={addBracket} className="flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-[0.6875rem] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]">
              <Plus className="h-3 w-3" /> Tramo
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                  <th className="py-1 pr-2">Desde</th>
                  <th className="py-1 pr-2 text-right">Base (calculada)</th>
                  <th className="py-1 pr-2 text-right">Tasa %</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {brackets.map((b, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-1 pr-2">
                      <input type="number" step="1" min={0} value={b.from} onChange={(e) => updateBracket(i, "from", Number(e.target.value) || 0)} className="hm-input w-28" />
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums text-[var(--color-text-muted)]">{money(bases[i] ?? 0)}</td>
                    <td className="py-1 pr-2">
                      <input type="number" step="0.01" min={0} max={99} value={rateToPercent(b.rate)} onChange={(e) => updateBracket(i, "rate", percentToRate(Number(e.target.value) || 0))} className="hm-input w-24" />
                    </td>
                    <td className="py-1">
                      {brackets.length > 1 && (
                        <button type="button" onClick={() => removeBracket(i)} className="text-[var(--color-danger-600)] hover:text-[var(--color-danger-700)]">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-[var(--color-text-muted)]">Vista previa del impacto en el IR mensual</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                <th className="py-1 pr-2">Salario mensual</th>
                <th className="py-1 pr-2 text-right">IR con la tabla vigente</th>
                <th className="py-1 pr-2 text-right">IR con la tabla nueva</th>
              </tr>
            </thead>
            <tbody>
              {IR_PREVIEW_SALARIES.map((salary) => {
                const irCurrent = round2(computeAnnualIr(salary * 12, current.irTableAnnual) / 12);
                const irNew = round2(computeAnnualIr(salary * 12, newLegal.irTableAnnual) / 12);
                return (
                  <tr key={salary} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-1 pr-2">{money(salary)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{money(irCurrent)}</td>
                    <td className={`py-1 pr-2 text-right tabular-nums font-medium ${irNew !== irCurrent ? "text-[var(--color-warning-700)]" : ""}`}>{money(irNew)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            disabled={!canConfirm}
            className="flex items-center gap-2 rounded-lg bg-[var(--color-primary-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-700)] disabled:opacity-50"
          >
            Continuar
          </button>
        </div>

        {showConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
              <h4 className="text-sm font-semibold text-[var(--color-text)]">Confirmar reforma</h4>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-[var(--color-text-secondary)]">Rige desde</span><span className="font-semibold">{fmtMonthValue(effectiveFrom)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-text-secondary)]">Base legal</span><span className="font-semibold">{legalBasis.trim()}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-text-secondary)]">Tramos de IR</span><span className="font-semibold">{brackets.length}</span></div>
              </div>
              <p className="rounded-lg border border-[var(--color-info-200)] bg-[var(--color-info-50)] px-3 py-2 text-xs text-[var(--color-info-700)]">
                Rige desde {fmtMonthValue(effectiveFrom)}. No afecta planillas ya posteadas.
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowConfirm(false)} disabled={saving} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] disabled:opacity-60">
                  Volver
                </button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-[var(--color-primary-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-700)] disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  {saving ? "Guardando…" : "Confirmar reforma"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
