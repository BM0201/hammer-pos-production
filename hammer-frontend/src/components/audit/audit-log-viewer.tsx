"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, ChevronDown, ChevronRight } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  resolveAuditEvent,
  GROUP_LABEL,
  type AuditEvent,
  type FilterGroup,
  type Role,
  type ResolvedEvent,
} from "@/components/audit/audit-descriptors";

/**
 * Bitácora legible (prompt-auditoria-v2.md) — línea de tiempo de frases
 * humanas agrupada por día, en vez de la tabla de log crudo de antes. La
 * traducción vive en audit-descriptors.ts; este componente solo presenta.
 */

const PAGE_SIZE = 60;

const ROLE_TOKEN: Record<Role, { bg: string; fg: string }> = {
  danger: { bg: "var(--color-danger-100)", fg: "var(--color-danger-700)" },
  warning: { bg: "var(--color-warning-100)", fg: "var(--color-warning-700)" },
  success: { bg: "var(--color-success-100)", fg: "var(--color-success-700)" },
  info: { bg: "var(--color-info-100)", fg: "var(--color-info-700)" },
  master: { bg: "var(--color-master-100)", fg: "var(--color-master-700)" },
  owner: { bg: "var(--color-owner-100)", fg: "var(--color-owner-700)" },
  neutral: { bg: "var(--color-surface-alt)", fg: "var(--color-text-muted)" },
};

const GROUP_CHIPS: FilterGroup[] = ["sales", "inventory", "cash", "pricing", "people"];

const DATE_PRESETS = [
  { key: "today", label: "Hoy" },
  { key: "7d", label: "7 días" },
  { key: "month", label: "Este mes" },
] as const;

function ymd(d: Date) {
  return d.toISOString().split("T")[0];
}

function presetRange(key: (typeof DATE_PRESETS)[number]["key"]) {
  const today = new Date();
  if (key === "today") return { from: ymd(today), to: ymd(today) };
  if (key === "7d") return { from: ymd(new Date(Date.now() - 7 * 86_400_000)), to: ymd(today) };
  return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today) };
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase() || "?";
}

function dayGroupLabel(occurredAt: string) {
  const d = new Date(occurredAt);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000);
  const full = d.toLocaleDateString("es-NI", { weekday: "long", day: "numeric", month: "long" });
  const cap = full.charAt(0).toUpperCase() + full.slice(1);
  if (diffDays === 0) return `Hoy · ${cap}`;
  if (diffDays === 1) return `Ayer · ${cap}`;
  return cap;
}

function timeOfDay(occurredAt: string) {
  return new Date(occurredAt).toLocaleTimeString("es-NI", { hour: "numeric", minute: "2-digit" });
}

function Headline({ actorLabel, resolved }: { actorLabel: string; resolved: ResolvedEvent }) {
  return (
    <span className="text-[13.5px] leading-relaxed text-[var(--color-text)]">
      <b className="font-bold">{actorLabel}</b>{" "}
      {resolved.headline.map((s, i) =>
        s.emphasis ? (
          <b key={i} className="font-semibold text-[var(--color-text)]">{s.text}</b>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}

function EventDetail({ event, resolved }: { event: AuditEvent; resolved: ResolvedEvent }) {
  return (
    <div className="ml-[3.1rem] -mt-2 mb-2 space-y-2 rounded-b-xl border border-t-0 border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3 text-[12.5px]">
      <div className="flex gap-2.5">
        <div className="w-32 flex-shrink-0 text-[var(--color-text-muted)]">Qué pasó</div>
        <div className="text-[var(--color-text-secondary)]">{resolved.detailProse}</div>
      </div>

      {resolved.diff && (
        <div className="flex gap-2.5">
          <div className="w-32 flex-shrink-0 text-[var(--color-text-muted)]">Qué cambió</div>
          <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
            <span className="text-[var(--color-text-soft)] line-through">{resolved.diff.was}</span>
            <span>→</span>
            <span className="font-semibold text-[var(--color-text)]">{resolved.diff.now}</span>
            {resolved.diff.delta && <span className="text-[var(--color-success-700)]">({resolved.diff.delta})</span>}
          </div>
        </div>
      )}

      {!resolved.mapped && resolved.rawMetadata && Object.keys(resolved.rawMetadata).length > 0 && (
        <div className="flex gap-2.5">
          <div className="w-32 flex-shrink-0 text-[var(--color-text-muted)]">Datos crudos</div>
          <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-text-soft)]" title={JSON.stringify(resolved.rawMetadata)}>
            {JSON.stringify(resolved.rawMetadata)}
          </div>
        </div>
      )}

      <div className="flex gap-2.5">
        <div className="w-32 flex-shrink-0 text-[var(--color-text-muted)]">Quién</div>
        <div className="text-[var(--color-text-secondary)]">
          {resolved.actorLabel}
          {event.actor?.username ? ` · usuario ${event.actor.username}` : ""}
          {event.ipAddress ? ` · desde ${event.ipAddress}` : ""}
        </div>
      </div>

      <div className="flex gap-2.5">
        <div className="w-32 flex-shrink-0 text-[var(--color-text-muted)]">Referencia técnica</div>
        <div>
          <span className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--color-text-soft)]">
            {event.entityType} / {event.entityId}
          </span>
        </div>
      </div>
    </div>
  );
}

export function AuditLogViewer({ branchFixed = false, defaultBranchId }: { branchFixed?: boolean; defaultBranchId?: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const initial7d = presetRange("7d");
  const [dateFrom, setDateFrom] = useState(initial7d.from);
  const [dateTo, setDateTo] = useState(initial7d.to);
  const [activePreset, setActivePreset] = useState<(typeof DATE_PRESETS)[number]["key"] | null>("7d");

  const [activeGroups, setActiveGroups] = useState<FilterGroup[]>([]);
  const [sensitiveOnly, setSensitiveOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async (offset: number, append: boolean) => {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (dateFrom) query.set("dateFrom", dateFrom);
    if (dateTo) query.set("dateTo", dateTo);
    if (branchFixed && defaultBranchId) query.set("branchId", defaultBranchId);
    if (appliedSearch) query.set("search", appliedSearch);

    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const response = await apiFetch(`/api/audit?${query.toString()}`);
      const raw = await response.json();
      if (!response.ok) {
        setMessage(raw.error?.message ?? raw.message ?? "No se pudo cargar la bitácora.");
        return;
      }
      const data = unwrapApiData(raw) as { rows: AuditEvent[]; total: number };
      setEvents((prev) => (append ? [...prev, ...(data.rows ?? [])] : (data.rows ?? [])));
      setTotal(data.total ?? 0);
      setMessage("");
    } catch {
      setMessage("No se pudo cargar la bitácora.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [dateFrom, dateTo, branchFixed, defaultBranchId, appliedSearch]);

  useEffect(() => { void load(0, false); }, [load]);

  function applyPreset(key: (typeof DATE_PRESETS)[number]["key"]) {
    const range = presetRange(key);
    setActivePreset(key);
    setDateFrom(range.from);
    setDateTo(range.to);
  }

  function submitSearch() {
    setAppliedSearch(searchInput.trim());
  }

  function toggleGroup(group: FilterGroup) {
    setSensitiveOnly(false);
    setActiveGroups((prev) => (prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group]));
  }

  function selectAll() {
    setActiveGroups([]);
    setSensitiveOnly(false);
  }

  function toggleSensitive() {
    setActiveGroups([]);
    setSensitiveOnly((v) => !v);
  }

  // Resolvemos cada evento una sola vez por render (memo por lista cargada).
  const resolved = useMemo(() => events.map((e) => ({ event: e, r: resolveAuditEvent(e) })), [events]);

  const filtered = useMemo(() => {
    return resolved.filter(({ r }) => {
      if (sensitiveOnly) return r.sensitive;
      if (activeGroups.length > 0) return r.filterGroup != null && activeGroups.includes(r.filterGroup);
      return true;
    });
  }, [resolved, sensitiveOnly, activeGroups]);

  const sensitiveLoadedCount = useMemo(() => resolved.filter(({ r }) => r.sensitive).length, [resolved]);

  const dayGroups = useMemo(() => {
    const groups: { label: string; items: typeof filtered }[] = [];
    for (const item of filtered) {
      const label = dayGroupLabel(item.event.occurredAt);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(item);
      else groups.push({ label, items: [item] });
    }
    return groups;
  }, [filtered]);

  const showAllActive = activeGroups.length === 0 && !sensitiveOnly;

  return (
    <section className="space-y-4">
      {/* Chips de grupo */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={selectAll}
          className="rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors"
          style={showAllActive
            ? { background: "var(--color-text)", borderColor: "var(--color-text)", color: "var(--color-page-bg)" }
            : { background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
        >
          Todo
        </button>
        <button
          type="button"
          onClick={toggleSensitive}
          className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${sensitiveOnly ? "text-white" : ""}`}
          style={sensitiveOnly
            ? { background: "var(--color-danger-600)", borderColor: "var(--color-danger-600)" }
            : { background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
        >
          ⚠ Sensible
        </button>
        {GROUP_CHIPS.map((g) => {
          const active = activeGroups.includes(g);
          return (
            <button
              key={g}
              type="button"
              onClick={() => toggleGroup(g)}
              className="rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors"
              style={active
                ? { background: "var(--color-text)", borderColor: "var(--color-text)", color: "var(--color-page-bg)" }
                : { background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
            >
              {GROUP_LABEL[g]}
            </button>
          );
        })}
      </div>

      {/* Buscador + rango de fechas */}
      <div className="flex flex-wrap gap-2.5">
        <div className="flex min-w-[16rem] flex-1 items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5">
          <Search className="flex-shrink-0 text-[var(--color-text-soft)]" style={{ width: "0.9375rem", height: "0.9375rem" }} />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitSearch(); }}
            placeholder="Buscar por persona, sucursal o qué pasó… (ej. «Harry», «descuento»)"
            className="w-full bg-transparent text-[13.5px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-soft)]"
          />
          {appliedSearch && (
            <button
              type="button"
              onClick={() => { setSearchInput(""); setAppliedSearch(""); }}
              className="flex-shrink-0 text-xs font-semibold text-[var(--color-text-soft)] hover:text-[var(--color-text)]"
            >
              Limpiar
            </button>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={submitSearch}>Buscar</Button>

        <div className="flex items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              className="rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors"
              style={activePreset === p.key
                ? { background: "var(--color-surface-alt)", color: "var(--color-text)" }
                : { color: "var(--color-text-soft)" }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          <input type="date" value={dateFrom} onChange={(e) => { setActivePreset(null); setDateFrom(e.target.value); }} className="hm-input px-2 py-1.5 text-xs" />
          <span>–</span>
          <input type="date" value={dateTo} onChange={(e) => { setActivePreset(null); setDateTo(e.target.value); }} className="hm-input px-2 py-1.5 text-xs" />
        </label>
      </div>

      {/* Meta línea */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <span>
          {total} evento{total !== 1 ? "s" : ""} en este rango
          {sensitiveLoadedCount > 0 && (
            <> · <b style={{ color: "var(--color-danger-700)" }}>{sensitiveLoadedCount} sensible{sensitiveLoadedCount !== 1 ? "s" : ""}</b> (de los cargados)</>
          )}
        </span>
        <button type="button" onClick={() => load(0, false)} className="ml-auto flex items-center gap-1 hover:text-[var(--color-text)]">
          <RefreshCw style={{ width: "0.75rem", height: "0.75rem" }} className={loading ? "animate-spin" : ""} />
          Actualizar
        </button>
      </div>

      {message && <p className="text-sm text-[var(--color-danger-700)]">{message}</p>}

      {/* Línea de tiempo */}
      {loading ? (
        <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">Cargando bitácora…</p>
      ) : dayGroups.length === 0 ? (
        <Card className="border-dashed p-8 text-center text-sm text-[var(--color-text-muted)]">
          Sin eventos para los filtros actuales.
        </Card>
      ) : (
        <div className="space-y-6">
          {dayGroups.map((group) => (
            <div key={group.label}>
              <div className="mb-2.5 pl-0.5 text-xs font-bold text-[var(--color-text-muted)]">{group.label}</div>
              <div className="space-y-2">
                {group.items.map(({ event, r }) => {
                  const tone = ROLE_TOKEN[r.role];
                  const isOpen = expandedId === event.id;
                  return (
                    <div key={event.id} className="animate-fade-in-up">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isOpen ? null : event.id)}
                        className="flex w-full items-center gap-3.5 rounded-xl border p-3.5 text-left transition-colors"
                        style={{
                          background: r.sensitive ? "color-mix(in srgb, var(--color-danger-600) 5%, var(--color-surface))" : "var(--color-surface)",
                          borderColor: r.sensitive ? "color-mix(in srgb, var(--color-danger-600) 25%, var(--color-border))" : "var(--color-border)",
                          borderBottomLeftRadius: isOpen ? 0 : undefined,
                          borderBottomRightRadius: isOpen ? 0 : undefined,
                        }}
                      >
                        <div
                          className="hm-avatar h-[2.125rem] w-[2.125rem] flex-shrink-0 text-[0.75rem]"
                          style={{ background: tone.bg, color: tone.fg }}
                        >
                          {initials(r.actorLabel)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <Headline actorLabel={r.actorLabel} resolved={r} />
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-text-soft)]">
                            {r.sensitive && <span className="hm-chip hm-chip-danger">⚠ Sensible</span>}
                            {event.branch && <span className="hm-chip">{event.branch.code}</span>}
                            <span className="hm-chip">{r.moduleLabel}</span>
                            {r.context && <span>{r.context}</span>}
                            <span className="sm:hidden">{timeOfDay(event.occurredAt)}</span>
                          </div>
                        </div>
                        <span className="hidden flex-shrink-0 text-[11px] text-[var(--color-text-soft)] sm:block">
                          {timeOfDay(event.occurredAt)}
                        </span>
                        {isOpen
                          ? <ChevronDown className="flex-shrink-0 text-[var(--color-text-soft)]" style={{ width: "0.875rem", height: "0.875rem" }} />
                          : <ChevronRight className="flex-shrink-0 text-[var(--color-text-soft)]" style={{ width: "0.875rem", height: "0.875rem" }} />}
                      </button>
                      {isOpen && <EventDetail event={event} resolved={r} />}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && events.length < total && (
        <div className="flex justify-center">
          <Button variant="secondary" size="sm" loading={loadingMore} onClick={() => load(events.length, true)}>
            Cargar más movimientos
          </Button>
        </div>
      )}
    </section>
  );
}
