"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, ScanLine, Plus, ChevronDown } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";
import {
  INVENTORY_GROUPS,
  resolveActiveNav,
  groupTone,
  buildNavSearchResults,
  shouldTriggerSearchShortcut,
  type InventoryTone,
  type NavSearchResultGroup,
} from "@/lib/inventory-nav-logic";

/**
 * prompt-inventario-inicio-fix.md Commit 1 — barra superior ÚNICA para
 * toda la sección de Inventario. Reemplaza InventoryLocalNav (al costado,
 * borrado) — "siempre la barra tiene que estar arriba, por cuestiones de
 * búsqueda y estética".
 *
 * Se monta en CADA pantalla del grupo (opción (b) del doc, ver reporte):
 * mover catalog-inventory/catalog/barcodes/inventory-fusion bajo
 * /inventory/* es un cambio de rutas grande, con riesgo real de romper
 * enlaces externos (Brain, notas, favoritos) que ya apuntan a esas rutas
 * — mucho más grande que lo que este doc puntual pide. Montar la barra en
 * cada página existente logra exactamente "toda pantalla del grupo
 * muestra la barra" sin mover un solo archivo.
 */

type Branch = { id: string; code: string; name: string };

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
  const sessionState = useSession();

  const branches: Branch[] = sessionState.status === "authenticated" ? (sessionState.session.branches ?? []).map((b) => ({ id: b.id, code: b.code ?? "", name: b.name })) : [];
  const defaultBranchId = sessionState.status === "authenticated" ? getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId) : "";

  // "El alcance va en la URL — ?branchId= o ?scope=network — y lo respetan
  // todas las subsecciones." Default: el mismo valor que el selector
  // GLOBAL de sucursal (encabezado de la app) — nunca dos selectores que
  // digan cosas distintas; cambiar el alcance ACÁ no toca ese selector
  // global (que afecta POS y otros módulos ajenos a Inventario).
  const scopeParam = searchParams.get("scope");
  const isNetwork = scopeParam === "network";
  const branchIdParam = searchParams.get("branchId");
  const activeBranchId = isNetwork ? "" : (branchIdParam || defaultBranchId);

  function setScope(next: { branchId: string } | { network: true }) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("branchId");
    params.delete("scope");
    if ("network" in next) params.set("scope", "network");
    else params.set("branchId", next.branchId);
    router.push(`${pathname}?${params.toString()}` as Route);
  }

  const active = useMemo(() => resolveActiveNav(pathname, searchParams.get("tab")), [pathname, searchParams]);

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
    // "Toda la red" manda SIN branchId — el backend agrega las 4 sucursales
    // en vez de filtrar a una (getInventoryOverview/getInventoryNavCounts
    // con branchId=null); nunca se salta el fetch ni muestra 0 por omisión.
    if (!isNetwork && !activeBranchId) return;
    const params = isNetwork ? "" : `?branchId=${activeBranchId}`;
    apiFetch(`/api/master/inventory/nav-counts${params}`)
      .then((res) => res.json())
      .then((raw) => setCounts(unwrapApiData(raw) as typeof counts))
      .catch(() => {});
  }, [activeBranchId, isNetwork]);

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

  const runSearch = useCallback(async (term: string, signal?: AbortSignal) => {
    // listInventoryProducts siempre pide branchId (ver su propio comentario
    // de diseño) — el buscador solo empareja por nombre/SKU/código, nunca
    // muestra costo/precio/stock, así que en "Toda la red" usa la sucursal
    // activa del usuario como referencia sin que eso afecte qué encuentra.
    const params = new URLSearchParams({ q: term, limit: "8", branchId: activeBranchId || defaultBranchId });
    const res = await apiFetch(`/api/master/inventory/products?${params}`, { signal });
    const raw = await res.json().catch(() => null);
    const data = raw ? (unwrapApiData(raw) as { rows: Array<{ id: string; sku: string; name: string; barcode: string | null }> }) : { rows: [] };
    const groups = buildNavSearchResults(term, data.rows ?? []);
    lastSearchedTerm.current = term;
    return groups;
  }, [activeBranchId, defaultBranchId]);

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

  return (
    <div className="sticky top-[3.5rem] z-20 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Fila 1 — título, alcance, buscador, acciones. En móvil se reacomoda
          con `order-*` en vez de duplicar nada: título+alcance comparten la
          primera línea, "+ Entrada" y el buscador bajan cada uno a su
          propia línea a lo ancho (así lo muestra inventario-inicio-movil.png
          — el alcance SIGUE visible en móvil, no se esconde en un menú). */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 lg:px-6">
        <h2 className="order-1 shrink-0 text-sm font-bold text-[var(--color-text)]">Inventario</h2>

        <div className="order-2 ml-auto md:order-3 md:ml-0">
          <ScopeSelector branches={branches} activeBranchId={activeBranchId} isNetwork={isNetwork} onChange={setScope} />
        </div>

        <div className="relative order-4 w-full md:order-2 md:w-auto md:min-w-[180px] md:max-w-xl md:flex-1">
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
            disponible desde Catálogo → Códigos de barra); desde md se suma
            junto al resto. */}
        <Link
          href={"/app/master/catalog/barcodes" as Route}
          className="order-5 hidden items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] md:order-4 md:inline-flex md:h-10"
        >
          <ScanLine className="h-4 w-4" /> Escanear
        </Link>

        <Link
          href={"/app/master/catalog-inventory?tab=movements" as Route}
          className="order-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--color-master-600)] px-3 text-xs font-semibold text-white hover:bg-[var(--color-master-700)] md:order-5 md:h-10 md:w-auto"
        >
          <Plus className="h-4 w-4" /> Entrada
        </Link>
      </div>

      {/* Fila 2 — grupos */}
      <div ref={groupScrollRef} className="flex gap-1 overflow-x-auto px-4 pb-1 lg:px-6" style={{ scrollbarWidth: "thin" }}>
        {INVENTORY_GROUPS.map((group) => {
          const isActive = group.key === active.groupKey;
          const tone = groupTone(group.key, counts);
          // "Existencias N" (inventario-inicio-desktop.png) — negativo + por agotarse + traslados atrasados: todo lo que ese grupo cubre, no solo lo que pinta de rojo (groupTone sigue sin contar "por agotarse" para el color, a propósito).
          const count =
            group.key === "catalog" ? counts.activeProducts
            : group.key === "stock" ? counts.negativeStock + counts.lowStock + counts.staleTransfers
            : group.key === "quality" ? counts.pendingQuality
            : null;
          return (
            <button
              key={group.key}
              ref={isActive ? activeGroupRef : null}
              type="button"
              onClick={() => router.push(group.subsections[0].path as Route)}
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

      {/* Fila 3 — subsecciones del grupo activo */}
      <div className="flex gap-1.5 overflow-x-auto border-t border-[var(--color-border)] px-4 py-1.5 lg:px-6" style={{ scrollbarWidth: "thin" }}>
        {activeGroup.subsections.map((sub) => {
          const isActive = !sub.external && sub.key === active.subsectionKey;
          const href = sub.tab ? `${sub.path}?tab=${sub.tab}` : sub.path;
          return (
            <Link
              key={sub.key}
              href={href as Route}
              className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                isActive ? "bg-[var(--color-master-50)] text-[var(--color-master-700)]" : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
              }`}
            >
              {sub.label}{sub.external ? " ↗" : ""}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function ScopeSelector({ branches, activeBranchId, isNetwork, onChange }: {
  branches: Branch[];
  activeBranchId: string;
  isNetwork: boolean;
  onChange: (next: { branchId: string } | { network: true }) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeBranch = branches.find((b) => b.id === activeBranchId);
  const label = isNetwork ? "Toda la red" : activeBranch ? `${activeBranch.name}` : "Elegir sucursal";

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} onBlur={() => window.setTimeout(() => setOpen(false), 160)} className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] md:h-10">
        {label} <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-40 mt-1 w-52 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-xl">
          {branches.map((b) => (
            <button key={b.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange({ branchId: b.id }); setOpen(false); }} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-[var(--color-surface-alt)]">
              {b.name} {b.id === activeBranchId && !isNetwork ? "✓" : ""}
            </button>
          ))}
          <div className="my-1 border-t border-[var(--color-border)]" />
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange({ network: true }); setOpen(false); }} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-[var(--color-surface-alt)]">
            Toda la red {isNetwork ? "✓" : ""}
          </button>
        </div>
      ) : null}
    </div>
  );
}
