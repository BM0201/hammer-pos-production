"use client";

import { Clock3 } from "lucide-react";

/** Fase 3.4 — "Posponer ▾" (1, 3, 7 o 30 días). Un <select> nativo es el desplegable más simple que funciona igual de bien en tablet/móvil. */
export function SnoozeSelect({ onPick, disabled }: { onPick: (days: number) => void; disabled?: boolean }) {
  return (
    <div className="relative inline-flex items-center">
      <select
        className="hm-input h-11 cursor-pointer appearance-none pl-8 pr-2 text-sm"
        disabled={disabled}
        value=""
        onChange={(e) => {
          const days = Number(e.target.value);
          if (days > 0) onPick(days);
          e.target.value = "";
        }}
        aria-label="Posponer"
      >
        <option value="">Posponer ▾</option>
        <option value="1">1 día</option>
        <option value="3">3 días</option>
        <option value="7">7 días</option>
        <option value="30">30 días</option>
      </select>
      <Clock3 className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-[var(--color-text-soft)]" aria-hidden="true" />
    </div>
  );
}
