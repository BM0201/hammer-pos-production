"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, ScanLine, Plus, ChevronDown } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useInventoryScope } from "@/hooks/use-inventory-scope";
import {
  INVENTORY_GROUPS,
  resolveActiveNav,
  buildInventoryHref,
  groupTone,
  buildNavSearchResults,
  shouldTriggerSearchShortcut,
  type InventoryTone,
  type NavSearchResultGroup,
} from "@/lib/inventory-nav-logic";
import type { ScopeBranch } from "@/lib/inventory-scope-logic";

/**
 * prompt-inventario-inicio-fix.md Commit 1 (base) + prompt-inventario-
 * unificado.md Commit 1 (reescritura) — barra superior ÚNICA para toda la
 * sección de Inventario.
 *
 * Reescritura: el botón de grupo ahora usa `buildInventoryHref` (antes
 * perdía el `?tab=` y el alcance de sucursal — bug #1 del doc, "Existencias
 * y Calidad no navegan"); el alcance viene de `useInventoryScope()`
 * (sucursales reales desde `/api/master/branches`, nunca de la sesión del
 * usuario — Master ve TODAS las sucursales, no solo sus membresías); fila 3
 * solo se dibuja si el grupo tiene más de una subsección (Inicio no tiene
 * ninguna fila 3 — "una sola página"); el buscador es flex-1 sin ancho
 * máximo y el padding horizontal iguala al del <main> global (px-5 lg:px-8)
 * para que el borde de la barra y el del contenido coincidan (bug #8).
 *
 * Se monta en CADA pantalla del grupo (Traslados y Reposición incluidos
 * ahora — ya no son "external"/↗, se muestran DENTRO del layout).
 */

const TONE_CLASSES: Record<InventoryTone, string> = {
  neutral: "text-[var(--color-text-secondary)]",
  danger: "text-[var(--color-danger-700)]",
  warning: "text-[var(--color-warning-700)]",
};
const TONE_BADGE_CLASSES: Record<InventoryTone, string> = {
  neutral: "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]",
  danger: "bg-[var(--color-danger-100)] text-[var(--color-danger-700)]",
  warning: "bg-[var(--color-warning-100)] text-[var(--color-warning-700)]",
};

export function InventoryTopbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const scope = useInventoryScope();

  const active = useMemo(
    () => resolveActiveNav(pathname, searchParams.get("tab"), Object.fromEntries(searchParams.entries())),
    [pathname, searchParams],
  );

  // §1.5 — "la barra sticky no tapa contenido: el scroll-margin-top de los
  // anclajes lo contempla". No hay anclajes hoy en Inventario, pero esto es
  // justo lo barato de dejar resuelto de una vez para cuando los haya —
  // aplica SOLO mientras esta barra está montada (se deshace al desmontar).
  useEffect(() => {
    const prev = document.documentElement.style.scrollPaddingTop;
    document.documentElement.style.scrollPaddingTop = "12rem";
    return () => { document.documentElement.style.scrollPaddingTop = prev; };
  }, []);

  const [counts, setCounts] = useState({ activeProducts: 0, negativeStock: 0, lowStock: 0, staleTransfers: 0, pendingQuality: 0 });
  useEffect(() => {
    if (scope.loading) return;
    // "Toda la red" manda SIN branchId — el backend agrega las sucursales
    // en vez de filtrar a una; nunca se salta el fetch ni muestra 0 por omisión.
    const params = scope.mode === "branch" && scope.branchId ? `?branchId=${scope.branchId}` : "";
    apiFetch(`/api/master/inventory/nav-counts${params}`)
      .then((res) => res.json())
      .then((raw) => setCounts(unwrapApiData(raw) as typeof counts))
      .catch(() => {});
  }, [scope.mode, scope.branchId, scope.loading]);

  // ── Buscador ───────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NavSearchResultGroup[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Qué término ya tiene resultados reales en `results` — un lector USB
  // tipea el código completo + Enter más rápido que el debounce de 200ms,
  // así que sin esto el Enter navegaría con resultados viejos (del término
  // anterior, o ninguno si recién se abrió el buscador).
  const lastSearchedTerm = useRef<string>("");

  const searchBranchId = scope.mode === "branch" ? scope.branchId : scope.branches[0]?.id;

  const runSearch = useCallback(async (term: string, signal?: AbortSignal) => {
    // listInventoryProducts siempre pide branchId (ver su propio comentario
    // de diseño) — el buscador solo empareja por nombre/SKU/código, nunca
    // muestra costo/precio/stock, así que en "Toda la red" usa la primera
    // sucursal como referencia sin que eso afecte qué encuentra.
    if (!searchBranchId) return [];
    const params = new URLSearchParams({ q: term, limit: "8", branchId: searchBranchId });
    const res = await apiFetch(`/api/master/inventory/products?${params}`, { signal });
    const raw = await res.json().catch(() => null);
    const data = raw ? (unwrapApiData(raw) as { rows: Array<{ id: string; sku: string; name: string; barcode: string | null }> }) : { rows: [] };
    const groups = buildNavSearchResults(term, data.rows ?? []);
    lastSearchedTerm.current = term;
    return groups;
  }, [searchBranchId]);

  useEffect(() => {
    const term = query.trim();
    if (!term) { setResults([]); lastSearchedTerm.current = ""; return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const groups = await runSearch(term, controller.signal);
        setResults(groups);
        setHighlighted(0);
      } catch {
        /* abortado o sin red — se queda con lo que había */
      }
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, runSearch]);

  const flatResults = useMemo(() => results.flatMap((g) => g.items), [results]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const activeTag = (document.activeElement as HTMLElement | null)?.tagName ?? null;
      if (shouldTriggerSearchShortcut(e.key, e.ctrlKey || e.metaKey, activeTag)) {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
      if (e.key === "Escape") setSearchOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, flatResults.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const term = query.trim();
      if (!term) return;
      // Lector USB/Bluetooth: código completo + Enter llega antes de que el
      // debounce busque ESTE término — buscar ya mismo en vez de navegar
      // con resultados de un término anterior.
      if (lastSearchedTerm.current !== term) {
        try {
          const groups = await runSearch(term);
          setResults(groups);
          const target = groups.flatMap((g) => g.items)[0];
          if (target) { router.push(target.href as Route); setSearchOpen(false); setQuery(""); }
        } catch {
          /* sin red — no navega */
        }
        return;
      }
      const target = flatResults[highlighted];
      if (target) { router.push(target.href as Route); setSearchOpen(false); setQuery(""); }
    }
  }

  const groupScrollRef = useRef<HTMLDivElement | null>(null);
  const activeGroupRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeGroupRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [active?.groupKey]);

  if (!active) return null; // No montada en una pantalla de Inventario — no debería pasar si cada page.tsx la incluye donde corresponde.

  const activeGroup = INVENTORY_GROUPS.find((g) => g.key === active.groupKey) ?? INVENTORY_GROUPS[0];
  const currentBranchParam = scope.mode === "all" ? "all" : scope.branchId;

  return (
    <div className="sticky top-[3.5rem] z-20 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Fila 1 — título, alcance, buscador, acciones. Mismo padding
          horizontal que el <main> global (p-5 lg:p-8) para que el borde de
          la barra coincida con el del contenido (bug #8). En móvil se
          reacomoda con `order-*`: título+alcance comparten la primera
          línea, "+ Nueva" y el buscador bajan cada uno a su propia línea. */}
      <div className="flex flex-wrap items-center gap-2 px-5 py-2 lg:px-8">
        <h2 className="order-1 shrink-0 text-sm font-bold text-[var(--color-text)]">Inventario</h2>

        <div className="order-2 ml-auto md:order-3 md:ml-0">
          <ScopeSelector scope={scope} />
        </div>

        <div className="relative order-4 w-full flex-1 md:order-2 md:w-auto md:min-w-[180px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 160)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Buscar producto, SKU, código o sección…"
            className="hm-input h-11 w-full pl-9 pr-14 md:h-10"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-muted)] sm:block">Ctrl K</kbd>

          {searchOpen && results.length > 0 ? (
            <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-96 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
              {results.map((group) => (
                <div key={group.kind}>
                  <p className="px-3 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                    {group.kind === "products" ? "Productos" : group.kind === "sections" ? "Secciones" : "Acciones"}
                  </p>
                  {group.items.map((item) => {
                    const flatIndex = flatResults.findIndex((f) => f.id === item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { router.push(item.href as Route); setSearchOpen(false); setQuery(""); }}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs ${flatIndex === highlighted ? "bg-[var(--color-surface-alt)]" : ""}`}
                      >
                        <span className="truncate font-medium text-[var(--color-text)]">{item.label}</span>
                        {item.sublabel ? <span className="shrink-0 font-mono text-[var(--color-text-muted)]">{item.sublabel}</span> : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Escanear — el mock móvil no lo muestra en la barra (sigue
            disponible desde Productos → Códigos de barra); desde md se suma
            junto al resto. */}
        <Link
          href={"/app/master/catalog/barcodes" as Route}
          className="order-5 hidden items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] md:order-4 md:inline-flex md:h-10"
        >
          <ScanLine className="h-4 w-4" /> Escanear
        </Link>

        {/* "+ Nueva ▾" con las 6 opciones es Commit 2 de prompt-inventario-
            unificado.md — acá solo se actualiza el destino a la nueva
            subsección "Entradas" (antes tab=movements). */}
        <Link
          href={"/app/master/catalog-inventory?tab=intakes" as Route}
          className="order-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--color-master-600)] px-3 text-xs font-semibold text-white hover:bg-[var(--color-master-700)] md:order-5 md:h-10 md:w-auto"
        >
          <Plus className="h-4 w-4" /> Entrada
        </Link>
      </div>

      {/* Fila 2 — grupos */}
      <div ref={groupScrollRef} className="flex gap-1 overflow-x-auto px-5 pb-1 lg:px-8" style={{ scrollbarWidth: "thin" }}>
        {INVENTORY_GROUPS.map((group) => {
          const isActive = group.key === active.groupKey;
          const tone = groupTone(group.key, counts);
          // "Existencias N" — negativo + por agotarse + traslados atrasados: todo lo que ese grupo cubre, no solo lo que pinta de rojo (groupTone sigue sin contar "por agotarse" para el color, a propósito).
          const count =
            group.key === "products" ? counts.activeProducts
            : group.key === "stock" ? counts.negativeStock + counts.lowStock + counts.staleTransfers
            : group.key === "quality" ? counts.pendingQuality
            : null;
          return (
            <button
              key={group.key}
              ref={isActive ? activeGroupRef : null}
              type="button"
              onClick={() => router.push(buildInventoryHref(group.subsections[0], { branch: currentBranchParam }) as Route)}
              className={`shrink-0 rounded-t-lg px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                isActive ? "border-b-2 border-[var(--color-master-600)] text-[var(--color-master-700)]" : `border-b-2 border-transparent ${TONE_CLASSES[tone]} hover:bg-[var(--color-surface-alt)]`
              }`}
            >
              {group.label}
              {count !== null && count > 0 ? (
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${TONE_BADGE_CLASSES[tone]}`}>{count.toLocaleString("es-NI")}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Fila 3 — subsecciones del grupo activo, "solo si tiene más de una" */}
      {activeGroup.subsections.length > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto border-t border-[var(--color-border)] px-5 py-1.5 lg:px-8" style={{ scrollbarWidth: "thin" }}>
          {activeGroup.subsections.map((sub) => {
            const isActive = sub.key === active.subsectionKey;
            const href = buildInventoryHref(sub, { branch: currentBranchParam });
            return (
              <Link
                key={sub.key}
                href={href as Route}
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  isActive ? "bg-[var(--color-master-50)] text-[var(--color-master-700)]" : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
                }`}
              >
                {sub.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ScopeSelector({ scope }: { scope: ReturnType<typeof useInventoryScope> }) {
  const [open, setOpen] = useState(false);
  const [filterText, setFilterText] = useState("");

  const activeBranch = scope.mode === "branch" ? scope.branches.find((b) => b.id === scope.branchId) : undefined;
  const label = scope.mode === "all" ? "Toda la red" : activeBranch ? `${activeBranch.code} · ${activeBranch.name}` : "Elegir sucursal";

  const visibleBranches = filterText.trim()
    ? scope.branches.filter((b) => `${b.code} ${b.name}`.toLowerCase().includes(filterText.trim().toLowerCase()))
    : scope.branches;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => window.setTimeout(() => setOpen(false), 160)}
        className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] md:h-10"
      >
        {label} <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-40 mt-1 w-60 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-xl">
          {scope.canShowNetwork ? (
            <>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { scope.setScope({ mode: "all", branchId: null }); setOpen(false); }}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs font-semibold hover:bg-[var(--color-surface-alt)]"
              >
                Toda la red · {scope.branches.length} sucursales {scope.mode === "all" ? "✓" : ""}
              </button>
              <div className="my-1 border-t border-[var(--color-border)]" />
            </>
          ) : null}
          {scope.branches.length > 6 ? (
            <div className="px-3 pb-1.5">
              <input
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filtrar sucursal…"
                className="hm-input h-8 w-full text-xs"
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>
          ) : null}
          {visibleBranches.map((b: ScopeBranch, i: number) => (
            <button
              key={b.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { scope.setScope({ mode: "branch", branchId: b.id }); setOpen(false); }}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-[var(--color-surface-alt)]"
            >
              <span>{b.code} · {b.name}</span>
              <span>{i === 0 && !filterText.trim() ? "★" : ""}{b.id === scope.branchId && scope.mode === "branch" ? " ✓" : ""}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
