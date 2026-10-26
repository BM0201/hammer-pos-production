"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { UNIT_GROUPS, displayUnit, normalizePresentationUnit } from "@/lib/inventory/presentation-units";

/**
 * Selector de unidad de venta — reemplaza el <input list> + <datalist>: el
 * navegador filtra un datalist por lo que YA dice el campo, así que con
 * "UNIDAD" escrito solo mostraba UNIDAD ("no me salen todas las unidades").
 * Acá se ven SIEMPRE todas, agrupadas; el filtro arranca vacío y solo se
 * usa si el usuario escribe. Una unidad que no está en la lista se puede
 * usar igual ("Usar «X»").
 *
 * `inline`: la grilla queda a la vista (panel de edición). Sin `inline`:
 * botón + panel desplegable (formularios densos y filas de fusión).
 */
export function UnitPicker({
  value,
  onChange,
  inline = false,
  compact = false,
  label,
}: {
  value: string;
  onChange: (unit: string) => void;
  inline?: boolean;
  /** Botón angosto para filas densas (presentaciones de una fusión). */
  compact?: boolean;
  /** Nombre accesible del control cuando no hay <label> visible al lado. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (inline) return <UnitGrid value={value} onPick={onChange} label={label} />;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label ? `${label}: ${value ? displayUnit(value) : "sin elegir"}` : undefined}
        className={[
          "flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-left font-semibold uppercase text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-master-500)]",
          compact ? "h-8 w-36 px-2 text-[11.5px]" : "h-10 w-full px-3 text-sm",
        ].join(" ")}
      >
        <span className={value ? "truncate" : "truncate font-normal normal-case text-[var(--color-text-soft)]"}>
          {value ? displayUnit(value.toUpperCase()) : "Elegir unidad"}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label ?? "Elegir unidad"}
          className="absolute left-0 top-full z-50 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 shadow-xl"
        >
          <UnitGrid value={value} onPick={(u) => { onChange(u); setOpen(false); }} withFilter label={label} />
        </div>
      )}
    </div>
  );
}

function UnitGrid({ value, onPick, withFilter = false, label }: { value: string; onPick: (unit: string) => void; withFilter?: boolean; label?: string }) {
  const [filter, setFilter] = useState("");
  const [custom, setCustom] = useState("");
  const customId = useId();
  const selected = value ? normalizePresentationUnit(value) : "";
  const term = normalizePresentationUnit(filter);
  const groups = UNIT_GROUPS
    .map((g) => ({ ...g, units: term ? g.units.filter((u) => u.includes(term) || displayUnit(u).includes(filter.trim().toUpperCase())) : g.units }))
    .filter((g) => g.units.length > 0);
  const known = UNIT_GROUPS.some((g) => g.units.includes(selected));
  const customCandidate = (withFilter ? filter : custom).trim().toUpperCase();

  return (
    <div className="space-y-3">
      {withFilter && (
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const first = groups[0]?.units[0];
            if (first) onPick(first);
            else if (customCandidate) onPick(customCandidate);
          }}
          placeholder="Buscar o escribir otra unidad…"
          aria-label="Buscar unidad"
          className="hm-input h-9 w-full text-sm"
        />
      )}

      {/* La unidad actual, si no es de la lista, igual se ve marcada. */}
      {selected && !known && (
        <div>
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Actual</p>
          <UnitChip unit={selected} selected onPick={onPick} />
        </div>
      )}

      {/* Desplegable: alto acotado con su propio scroll. A la vista (panel): todas, sin scroll anidado. */}
      <div role="radiogroup" aria-label={label ?? "Unidad de venta"} className={withFilter ? "max-h-72 space-y-2.5 overflow-y-auto pr-1" : "space-y-2.5"}>
        {groups.map((group) => (
          <div key={group.label}>
            <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{group.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.units.map((u) => <UnitChip key={u} unit={u} selected={u === selected} onPick={onPick} />)}
            </div>
          </div>
        ))}
        {groups.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">Ninguna unidad de la lista coincide.</p>}
      </div>

      {withFilter ? (
        customCandidate && groups.length === 0 ? (
          <button type="button" onClick={() => onPick(customCandidate)} className="w-full rounded-lg border border-dashed border-[var(--color-master-300)] px-3 py-2 text-left text-xs font-semibold text-[var(--color-master-700)] hover:bg-[var(--color-master-50)]">
            Usar «{customCandidate}»
          </button>
        ) : null
      ) : (
        <div className="flex items-center gap-2 border-t border-[var(--color-border)] pt-3">
          <label htmlFor={customId} className="shrink-0 text-xs text-[var(--color-text-muted)]">¿Otra?</label>
          <input
            id={customId}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && customCandidate) { e.preventDefault(); onPick(customCandidate); setCustom(""); } }}
            placeholder="Ej: TONELADA"
            className="hm-input h-9 min-w-0 flex-1 text-sm uppercase"
          />
          <button
            type="button"
            disabled={!customCandidate}
            onClick={() => { onPick(customCandidate); setCustom(""); }}
            className="h-9 shrink-0 rounded-lg border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] disabled:opacity-40"
          >
            Usar
          </button>
        </div>
      )}
    </div>
  );
}

function UnitChip({ unit, selected, onPick }: { unit: string; selected: boolean; onPick: (unit: string) => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onPick(unit)}
      className={[
        "inline-flex h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-master-500)]",
        selected
          ? "border-[var(--color-master-600)] bg-[var(--color-master-600)] text-white"
          : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-master-300)] hover:text-[var(--color-master-700)]",
      ].join(" ")}
    >
      {selected && <Check className="h-3 w-3" aria-hidden="true" />}
      {displayUnit(unit)}
    </button>
  );
}
