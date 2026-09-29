"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Receipt, RefreshCw, Save, AlertTriangle } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money } from "@/lib/format";
import { buildPayrollConfigPatch, type PayrollConfigFields } from "@/components/payroll/payroll-config-patch";
import { LegalRatesSection, type LegalRateVersionSummary } from "@/components/payroll/legal-rates-section";
import type { LegalRates } from "@/components/finance/payroll-calc";

/**
 * prompt-nomina-config.md Fase 1 — PATCH /api/payroll/rates existía
 * (régimen INSS, modos de prestaciones, salario mínimo) pero nada lo
 * llamaba: cambiar el régimen o el mínimo exigía tocar la base a mano.
 * Mismo patrón visual que master/settings/print/page.tsx.
 */

type InssRegime = PayrollConfigFields["inssRegime"];
type BenefitAccrualMode = PayrollConfigFields["aguinaldoMode"];

type IrBracket = { from: number; base: number; rate: number };

type RatesResponse = {
  rates: {
    inssRegime: InssRegime;
    activeEmployeeCount: number;
    inatecRate: number;
    aguinaldoMode: BenefitAccrualMode;
    vacacionesMode: BenefitAccrualMode;
    indemnizacionMode: BenefitAccrualMode;
    salarioMinimoSectorial: number;
  };
  inss: { laboral: number; patronal: number };
  irTableAnnual: IrBracket[];
  activeEmployeesBelowMinimum: number;
  legal: LegalRates;
  legalSource: string;
  legalVersions: LegalRateVersionSummary[];
};

const INSS_REGIME_OPTIONS: { value: InssRegime; label: string }[] = [
  { value: "INTEGRAL", label: "Integral" },
  { value: "IVM_RP", label: "IVM-RP" },
];

const BENEFIT_MODE_OPTIONS: { value: BenefitAccrualMode; label: string }[] = [
  { value: "ACCRUE_MONTHLY", label: "Provisionar cada mes" },
  { value: "ON_PAYMENT", label: "Reconocer al pagar" },
];

const BENEFIT_FIELDS: { key: "aguinaldoMode" | "vacacionesMode" | "indemnizacionMode"; label: string }[] = [
  { key: "aguinaldoMode", label: "Aguinaldo" },
  { key: "vacacionesMode", label: "Vacaciones" },
  { key: "indemnizacionMode", label: "Indemnización" },
];

function toFields(rates: RatesResponse["rates"]): PayrollConfigFields {
  return {
    inssRegime: rates.inssRegime,
    aguinaldoMode: rates.aguinaldoMode,
    vacacionesMode: rates.vacacionesMode,
    indemnizacionMode: rates.indemnizacionMode,
    salarioMinimoSectorial: rates.salarioMinimoSectorial,
  };
}

const FIELD_LABEL: Record<keyof PayrollConfigFields, string> = {
  inssRegime: "Régimen INSS",
  aguinaldoMode: "Aguinaldo",
  vacacionesMode: "Vacaciones",
  indemnizacionMode: "Indemnización",
  salarioMinimoSectorial: "Salario mínimo sectorial",
};

function describeValue(field: keyof PayrollConfigFields, value: PayrollConfigFields[keyof PayrollConfigFields]): string {
  if (field === "salarioMinimoSectorial") return money(value as number);
  if (field === "inssRegime") return INSS_REGIME_OPTIONS.find((o) => o.value === value)?.label ?? String(value);
  return BENEFIT_MODE_OPTIONS.find((o) => o.value === value)?.label ?? String(value);
}

export default function PayrollConfigPage() {
  const [data, setData] = useState<RatesResponse | null>(null);
  const [original, setOriginal] = useState<PayrollConfigFields | null>(null);
  const [edited, setEdited] = useState<PayrollConfigFields | null>(null);
  const [salarioInput, setSalarioInput] = useState("0");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch("/api/payroll/rates");
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar la configuración.");
      const parsed = unwrapApiData(raw) as RatesResponse;
      setData(parsed);
      const fields = toFields(parsed.rates);
      setOriginal(fields);
      setEdited(fields);
      setSalarioInput(String(fields.salarioMinimoSectorial));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar la configuración.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function updateField<K extends keyof PayrollConfigFields>(key: K, value: PayrollConfigFields[K]) {
    setEdited((current) => (current ? { ...current, [key]: value } : current));
  }

  const patch = original && edited ? buildPayrollConfigPatch(original, edited) : {};
  const patchEntries = Object.entries(patch) as [keyof PayrollConfigFields, PayrollConfigFields[keyof PayrollConfigFields]][];
  const hasChanges = patchEntries.length > 0;

  async function confirmSave() {
    if (!hasChanges) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/payroll/rates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo guardar la configuración.");
      const parsed = unwrapApiData(raw) as RatesResponse;
      setData(parsed);
      const fields = toFields(parsed.rates);
      setOriginal(fields);
      setEdited(fields);
      setSalarioInput(String(fields.salarioMinimoSectorial));
      setShowConfirm(false);
      toast.success("Configuración de nómina guardada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !data || !edited) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-[var(--color-text-muted)]">Cargando configuración…</div>;
  }

  // Tasa INSS resuelta EN VIVO para el conteo actual de empleados, con el
  // régimen que se está editando — el backend ya la calcula (inss del GET)
  // para el régimen guardado; si el usuario cambió el selector sin guardar
  // todavía, se resuelve la misma fórmula acá para que la vista previa no
  // mienta (mismo umbral de 50 que ya usa resolveInssRates).
  const large = data.rates.activeEmployeeCount >= 50;
  const previewInss = edited.inssRegime === data.rates.inssRegime
    ? data.inss
    : edited.inssRegime === "IVM_RP"
      ? { laboral: 0.05, patronal: large ? 0.165 : 0.155 }
      : { laboral: 0.07, patronal: large ? 0.225 : 0.215 };

  return (
    <section className="max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-primary-50)]">
          <Receipt className="h-5 w-5 text-[var(--color-primary-600)]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">Configuración de nómina</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Régimen INSS, prestaciones y salario mínimo sectorial — aplica a toda la empresa.</p>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-5">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Configuración de la empresa</h2>

        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">Régimen INSS</label>
          <select
            value={edited.inssRegime}
            onChange={(e) => updateField("inssRegime", e.target.value as InssRegime)}
            className="w-full max-w-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          >
            {INSS_REGIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            {data.rates.activeEmployeeCount} empleado{data.rates.activeEmployeeCount !== 1 ? "s" : ""} activo{data.rates.activeEmployeeCount !== 1 ? "s" : ""} en toda la empresa → tasa patronal de empresa {large ? "grande" : "pequeña"} (umbral: 50).
            {" "}Laboral {(previewInss.laboral * 100).toFixed(2)}% · Patronal {(previewInss.patronal * 100).toFixed(2)}%.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-[var(--color-text)]">Prestaciones</p>
            <p className="text-xs text-[var(--color-text-muted)]">Aguinaldo, vacaciones e indemnización son obligaciones legales — no se pueden desactivar, solo cambia cuándo entran al costo mensual.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {BENEFIT_FIELDS.map(({ key, label }) => (
              <label key={key} className="text-sm font-medium text-[var(--color-text)]">
                {label}
                <select
                  value={edited[key]}
                  onChange={(e) => updateField(key, e.target.value as BenefitAccrualMode)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                >
                  {BENEFIT_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">Salario mínimo sectorial</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={salarioInput}
            onChange={(e) => {
              setSalarioInput(e.target.value);
              const n = Number(e.target.value);
              updateField("salarioMinimoSectorial", Number.isFinite(n) && n >= 0 ? n : edited.salarioMinimoSectorial);
            }}
            className="w-full max-w-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          />
          {data.activeEmployeesBelowMinimum > 0 && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {data.activeEmployeesBelowMinimum} empleado{data.activeEmployeesBelowMinimum !== 1 ? "s" : ""} activo{data.activeEmployeesBelowMinimum !== 1 ? "s" : ""} gana{data.activeEmployeesBelowMinimum === 1 ? "" : "n"} menos que este mínimo. Es informativo — no bloquea nada.
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            disabled={!hasChanges || saving}
            className="flex items-center gap-2 rounded-lg bg-[var(--color-primary-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-700)] disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            Guardar cambios
          </button>
        </div>
      </div>

      <LegalRatesSection
        legal={data.legal}
        legalSource={data.legalSource}
        legalVersions={data.legalVersions}
        onChanged={() => void load()}
      />

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Confirmar cambios</h3>
            <div className="space-y-2 text-sm">
              {patchEntries.map(([field, value]) => (
                <div key={field} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2">
                  <span className="text-[var(--color-text-secondary)]">{FIELD_LABEL[field]}</span>
                  <span className="text-right">
                    <span className="text-[var(--color-text-muted)] line-through">{describeValue(field, original![field])}</span>
                    {" → "}
                    <span className="font-semibold text-[var(--color-text)]">{describeValue(field, value)}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="rounded-lg border border-[var(--color-info-200)] bg-[var(--color-info-50)] px-3 py-2 text-xs text-[var(--color-info-700)]">
              Las planillas ya posteadas no cambian. Aplica a borradores y cálculos nuevos.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowConfirm(false)} disabled={saving} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] disabled:opacity-60">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmSave()}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-[var(--color-primary-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-700)] disabled:opacity-50"
              >
                {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? "Guardando…" : "Confirmar y guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
