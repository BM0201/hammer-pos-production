"use client";

import { useId } from "react";

/**
 * prompt-historial-sucursal.md Fase 3.2 — extraído de CancelModal
 * (orders-admin.tsx) para compartirlo con SaleCancellationExecuteModal:
 * una sola fuente de estos textos. El backend exige declarar qué pasó con
 * el efectivo cuando el pago tiene tenders CASH y la caja sigue abierta
 * (ver resolveCancellationCashPlan, sales/cancellation-cash-policy.ts).
 */
export type CashRefundHandling = "REFUNDED_FROM_DRAWER" | "NO_CASH_MOVEMENT";

export function CashRefundHandlingPicker({
  value,
  onChange,
}: {
  value: CashRefundHandling;
  onChange: (value: CashRefundHandling) => void;
}) {
  // useId — dos instancias de este picker (CancelModal + el modal de
  // ejecutar anulación) no deben compartir el mismo name de radio-group.
  const groupName = useId();

  return (
    <fieldset className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
      <legend className="px-1 text-sm font-medium text-[var(--color-text)]">
        ¿Se devolvió el efectivo de la gaveta?
      </legend>
      <label className="flex cursor-pointer items-start gap-2 py-1 text-sm text-[var(--color-text-secondary)]">
        <input
          type="radio"
          name={groupName}
          className="mt-0.5"
          checked={value === "REFUNDED_FROM_DRAWER"}
          onChange={() => onChange("REFUNDED_FROM_DRAWER")}
        />
        <span>
          <strong>Sí</strong> — se entregó el efectivo al cliente (queda registrado como salida de caja)
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2 py-1 text-sm text-[var(--color-text-secondary)]">
        <input
          type="radio"
          name={groupName}
          className="mt-0.5"
          checked={value === "NO_CASH_MOVEMENT"}
          onChange={() => onChange("NO_CASH_MOVEMENT")}
        />
        <span>
          <strong>No</strong> — el dinero nunca entró a la gaveta / fue un error antes de cobrar
        </span>
      </label>
      <p className="mt-1 text-xs text-[var(--color-text-soft)]">
        Solo aplica si el pago incluyó efectivo y la caja sigue abierta.
      </p>
    </fieldset>
  );
}
