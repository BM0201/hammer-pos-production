"use client";

import { useCallback, useEffect, useState } from "react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { orderScopeBranches, resolveInventoryScope, scopeToParamValue, canShowNetworkOption, type ScopeBranch, type InventoryScopeValue } from "@/lib/inventory-scope-logic";

/**
 * prompt-inventario-unificado.md Commit 1 §4 — "contexto de sucursal
 * compartido": un solo lugar que lee la URL/localStorage y devuelve el
 * alcance efectivo. `catalog-inventory-admin.tsx`, `MovementsPanel`, la
 * matriz, el Kardex, Códigos, Fusión, Traslados y Reposición lo usan EN
 * VEZ de su propio selector de sucursal — por eso quedan 0 selectores de
 * sucursal propios después de este commit, solo el de la barra.
 *
 * Clave de localStorage DISTINTA de `hammer_active_branch_id` (el
 * selector GLOBAL de la app, que afecta POS y otros módulos ajenos a
 * Inventario) — cambiar el alcance acá nunca toca ese selector global, ni
 * al revés.
 */
const STORAGE_KEY = "hammer_inventory_scope";

function readStoredScope(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredScope(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* localStorage no disponible (SSR, privacidad) — el alcance sigue funcionando por URL */
  }
}

/** `branch=` es el parámetro nuevo; `branchId=`/`scope=network` siguen leyéndose por compatibilidad con links viejos. */
function readUrlScope(searchParams: URLSearchParams): string | null {
  const branch = searchParams.get("branch");
  if (branch) return branch;
  if (searchParams.get("scope") === "network") return "all";
  const legacyBranchId = searchParams.get("branchId");
  if (legacyBranchId) return legacyBranchId;
  return null;
}

export type InventoryScope = InventoryScopeValue & {
  /** Sucursales activas visibles, principal primero (★) y el resto por código — ya en el orden que el desplegable debe mostrar. */
  branches: ScopeBranch[];
  branchCode: string | null;
  canShowNetwork: boolean;
  loading: boolean;
  setScope: (next: InventoryScopeValue) => void;
};

export function useInventoryScope(): InventoryScope {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [branches, setBranches] = useState<ScopeBranch[]>([]);
  const [primaryBranchId, setPrimaryBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch("/api/master/branches").then((r) => r.json()).then(unwrapApiData),
      apiFetch("/api/master/inventory/config/primary-branch").then((r) => r.json()).then(unwrapApiData),
    ])
      .then(([branchRows, primaryConfig]) => {
        if (cancelled) return;
        const rows = (branchRows as Array<{ id: string; code: string; name: string; isActive: boolean }>) ?? [];
        setBranches(rows.filter((b) => b.isActive));
        setPrimaryBranchId((primaryConfig as { branchId: string | null })?.branchId ?? null);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const urlValue = readUrlScope(searchParams);
  const storedValue = readStoredScope();
  const ordered = orderScopeBranches(branches, primaryBranchId);
  const scope = resolveInventoryScope({ urlValue, storedValue, primaryBranchId, branches: ordered });
  const branchCode = scope.branchId ? (ordered.find((b) => b.id === scope.branchId)?.code ?? null) : null;

  const setScope = useCallback((next: InventoryScopeValue) => {
    const value = scopeToParamValue(next);
    writeStoredScope(value);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("branchId");
    params.delete("scope");
    params.set("branch", value);
    router.push(`${pathname}?${params.toString()}` as Route);
  }, [pathname, router, searchParams]);

  return {
    ...scope,
    branches: ordered,
    branchCode,
    canShowNetwork: canShowNetworkOption(ordered),
    loading,
    setScope,
  };
}
