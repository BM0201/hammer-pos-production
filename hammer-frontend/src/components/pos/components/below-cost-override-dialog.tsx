"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ProductRow } from "../types";

const MIN_REASON_LENGTH = 10;

export type BelowCostConfirmState = {
  product: ProductRow;
  effectiveCost: number | null;
  netUnitPriceAfterDiscount: number | null;
};

type BelowCostOverrideDialogProps = {
  pending: BelowCostConfirmState | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

function money(value: number | null) {
  return value === null ? "—" : `C$ ${value.toFixed(2)}`;
}

/**
 * prompt-fusionado-invendible-409.md §P-3 — el backend distingue
 * BELOW_COST_NOT_ALLOWED (sin autoridad) de BELOW_COST_OVERRIDE_REASON_REQUIRED
 * (con autoridad, falta razón). Este diálogo solo se ofrece ante el segundo —
 * la autorización la decide el backend, no se infiere acá del rol de sesión.
 *
 * El costo tiene que estar a la vista: es lo que hace que un costo absurdo
 * (ej. C$22,400 el quintal) se lea como error de dato y no se autorice por
 * reflejo. Sin razón pre-llena, sin motivo frecuente en desplegable — una
 * razón autogenerada no es una justificación.
 */
export function BelowCostOverrideDialog({ pending, isSubmitting, onCancel, onConfirm }: BelowCostOverrideDialogProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!pending) setReason("");
  }, [pending]);

  if (!pending) return null;

  const { product, effectiveCost, netUnitPriceAfterDiscount } = pending;
  const lossPerUnit = effectiveCost !== null && netUnitPriceAfterDiscount !== null ? effectiveCost - netUnitPriceAfterDiscount : null;
  const reasonOk = reason.trim().length >= MIN_REASON_LENGTH;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onCancel} aria-hidden="true" />
      <div
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85vh] max-w-sm flex-col gap-4 overflow-y-auto rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-modal)] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Confirmar venta bajo costo"
        data-testid="below-cost-override-dialog"
      >
        <div className="flex flex-none items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-[var(--color-text)]">Venta bajo costo</h2>
            <p className="text-sm text-[var(--color-text-soft)]">{product.name}</p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-lg p-1.5 text-[var(--color-text-soft)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"
            aria-label="Cancelar"
            disabled={isSubmitting}
          >
            ✕
          </button>
        </div>

        <div className="grid flex-none grid-cols-2 gap-3">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
            <p className="text-xs text-[var(--color-text-muted)]">Costo efectivo</p>
            <p className="tabular-nums text-base font-bold text-[var(--color-text)]">{money(effectiveCost)}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-warning-200)] bg-[color-mix(in_srgb,var(--color-warning-50)_40%,white)] p-3">
            <p className="text-xs text-[var(--color-text-muted)]">Precio neto</p>
            <p className="tabular-nums text-base font-bold text-[var(--color-warning-700)]">{money(netUnitPriceAfterDiscount)}</p>
          </div>
        </div>

        {lossPerUnit !== null && (
          <p className="flex-none text-sm text-[var(--color-danger-600)]">
            Pérdida por unidad: <span className="font-bold tabular-nums">{money(lossPerUnit)}</span>
          </p>
        )}

        <label className="grid flex-none gap-1.5">
          <span className="text-xs font-semibold text-[var(--color-text-muted)]">
            Razón del override <span className="font-bold text-[var(--color-warning-600)]">*</span>
          </span>
          <textarea
            className="hm-input min-h-[4.5rem] resize-none rounded-lg px-3 py-2 text-sm"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={`Obligatoria (mínimo ${MIN_REASON_LENGTH} caracteres)…`}
            disabled={isSubmitting}
            autoFocus
          />
          {reason.trim().length > 0 && !reasonOk && (
            <span className="text-xs text-[var(--color-warning-600)]">
              Mínimo {MIN_REASON_LENGTH} caracteres ({reason.trim().length}/{MIN_REASON_LENGTH})
            </span>
          )}
        </label>

        <div className="flex flex-none justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" onClick={() => onConfirm(reason.trim())} disabled={!reasonOk} loading={isSubmitting}>
            Autorizar venta
          </Button>
        </div>
      </div>
    </>
  );
}
