"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { money } from "@/lib/format";
import type { LegalRates } from "@/components/finance/payroll-calc";
import { LegalRateVersionForm } from "./legal-rate-version-form";

/**
 * prompt-nomina-config.md Fase 3.2 — reemplaza el bloque de solo lectura de
 * la Fase 1: vigente + historial + "Registrar reforma". Las tasas legales
 * (INSS, INATEC, IR) dejan de ser constantes fijas en código.
 */

export type LegalRateVersionSummary = LegalRates & {
  id: string;
  effectiveFrom: string;
  legalBasis: string;
  createdByUserId: string | null;
  createdAt: string;
  deletable: boolean;
};

const MES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function fmtMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MES_LARGO[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function LegalRatesSection({
  legal,
  legalSource,
  legalVersions,
  onChanged,
}: {
  legal: LegalRates;
  legalSource: string;
  legalVersions: LegalRateVersionSummary[];
  onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const vigente = legalSource === "DEFAULT" ? null : legalVersions.find((v) => v.id === legalSource) ?? null;
  const originLabel = vigente ? `Versión desde ${fmtMonth(vigente.effectiveFrom)} — ${vigente.legalBasis}` : "Valores por defecto del sistema";

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await apiFetch(`/api/payroll/legal-rates/${id}`, { method: "DELETE" });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo eliminar la versión.");
      toast.success("Versión eliminada — vuelve a regir la anterior.");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar la versión.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Tasas legales</h2>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-primary-300)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary-700)] hover:bg-[var(--color-primary-50)]"
        >
          <Plus className="h-3.5 w-3.5" />
          Registrar reforma
        </button>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-[var(--color-text-muted)]">Vigente — {originLabel}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                <th className="py-1.5 pr-3">Concepto</th>
                <th className="py-1.5 pr-3 text-right">Tasa</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--color-border)]"><td className="py-1.5 pr-3">INSS laboral (Integral)</td><td className="py-1.5 pr-3 text-right">{(legal.inssIntegralLaboral * 100).toFixed(2)}%</td></tr>
              <tr className="border-b border-[var(--color-border)]"><td className="py-1.5 pr-3">INSS patronal Integral, empresa &lt;{legal.inssEmployerSizeThreshold}</td><td className="py-1.5 pr-3 text-right">{(legal.inssIntegralPatronalLt50 * 100).toFixed(2)}%</td></tr>
              <tr className="border-b border-[var(--color-border)]"><td className="py-1.5 pr-3">INSS patronal Integral, empresa ≥{legal.inssEmployerSizeThreshold}</td><td className="py-1.5 pr-3 text-right">{(legal.inssIntegralPatronalGte50 * 100).toFixed(2)}%</td></tr>
              <tr className="border-b border-[var(--color-border)]"><td className="py-1.5 pr-3">INSS laboral (IVM-RP)</td><td className="py-1.5 pr-3 text-right">{(legal.inssIvmRpLaboral * 100).toFixed(2)}%</td></tr>
              <tr className="border-b border-[var(--color-border)]"><td className="py-1.5 pr-3">INSS patronal IVM-RP, empresa &lt;{legal.inssEmployerSizeThreshold}</td><td className="py-1.5 pr-3 text-right">{(legal.inssIvmRpPatronalLt50 * 100).toFixed(2)}%</td></tr>
              <tr className="border-b border-[var(--color-border)]"><td className="py-1.5 pr-3">INSS patronal IVM-RP, empresa ≥{legal.inssEmployerSizeThreshold}</td><td className="py-1.5 pr-3 text-right">{(legal.inssIvmRpPatronalGte50 * 100).toFixed(2)}%</td></tr>
              <tr><td className="py-1.5 pr-3">INATEC (patronal, ambos regímenes)</td><td className="py-1.5 pr-3 text-right">{(legal.inatecRate * 100).toFixed(2)}%</td></tr>
            </tbody>
          </table>
        </div>

        <p className="mb-1 pt-3 text-sm font-medium text-[var(--color-text)]">Tabla IR anual (Ley 822, art. 23)</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                <th className="py-1.5 pr-3">Desde</th>
                <th className="py-1.5 pr-3 text-right">Base</th>
                <th className="py-1.5 pr-3 text-right">Tasa sobre exceso</th>
              </tr>
            </thead>
            <tbody>
              {legal.irTableAnnual.map((b, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-1.5 pr-3">{money(b.from)}</td>
                  <td className="py-1.5 pr-3 text-right">{money(b.base)}</td>
                  <td className="py-1.5 pr-3 text-right">{(b.rate * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {legalVersions.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold text-[var(--color-text-muted)]">Historial</p>
          <div className="space-y-1.5">
            {legalVersions.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2 text-xs">
                <div className="min-w-0">
                  <span className="font-medium text-[var(--color-text)]">{fmtMonth(v.effectiveFrom)}</span>
                  <span className="ml-2 text-[var(--color-text-muted)]">{v.legalBasis}</span>
                </div>
                {v.deletable && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(v.id)}
                    disabled={deletingId === v.id}
                    className="flex shrink-0 items-center gap-1 rounded border border-[var(--color-danger-300)] px-2 py-1 text-[0.6875rem] text-[var(--color-danger-700)] hover:bg-[var(--color-danger-50)] disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" />
                    {deletingId === v.id ? "Eliminando…" : "Eliminar"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <LegalRateVersionForm
          current={legal}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
