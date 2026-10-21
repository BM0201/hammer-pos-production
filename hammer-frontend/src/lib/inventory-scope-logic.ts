/**
 * prompt-inventario-unificado.md Commit 1 — lógica pura del alcance de
 * sucursal único para toda Inventario: orden del desplegable, resolución en
 * cascada (URL → guardado → principal → primera activa) y si corresponde
 * ofrecer "Toda la red". Nada de sucursales fijas acá — todo entra como
 * dato (`branches`), nunca como literal ("MGA"/"MSY"/"RIV" no aparecen en
 * este archivo ni en sus tests).
 */

export type ScopeBranch = { id: string; code: string; name: string; isActive: boolean };
export type InventoryScopeValue = { mode: "all" | "branch"; branchId: string | null };

/** "Toda la red" no tiene sentido (ni se ofrece) con 0 o 1 sucursal visible. */
export function canShowNetworkOption(branches: ScopeBranch[]): boolean {
  return branches.filter((b) => b.isActive).length > 1;
}

/** Principal primero (★), el resto por código — "la principal con ★", "el resto ordenadas por código". */
export function orderScopeBranches(branches: ScopeBranch[], primaryBranchId: string | null): ScopeBranch[] {
  const active = branches.filter((b) => b.isActive);
  const primary = active.find((b) => b.id === primaryBranchId);
  const rest = active.filter((b) => b.id !== primaryBranchId).sort((a, b) => a.code.localeCompare(b.code));
  return primary ? [primary, ...rest] : rest;
}

/**
 * Resuelve el alcance efectivo en cascada: URL > guardado (localStorage) >
 * principal > primera activa (por código) > "Toda la red" si no queda
 * ninguna. "Si la sucursal guardada... ya no existe o el usuario perdió
 * acceso, se cae a la principal sin error, y si tampoco existe, a la
 * primera activa" — nunca revienta, nunca deja branchId apuntando a algo
 * que `branches` no contiene.
 */
export function resolveInventoryScope(input: {
  urlValue: string | null; // "all" | id | código | null
  storedValue: string | null; // ídem, de localStorage
  primaryBranchId: string | null;
  branches: ScopeBranch[];
}): InventoryScopeValue {
  const active = input.branches.filter((b) => b.isActive);
  const findByIdOrCode = (value: string) => active.find((b) => b.id === value || b.code === value);

  for (const candidate of [input.urlValue, input.storedValue]) {
    if (candidate === "all") return { mode: "all", branchId: null };
    if (candidate) {
      const found = findByIdOrCode(candidate);
      if (found) return { mode: "branch", branchId: found.id };
    }
  }

  const primary = active.find((b) => b.id === input.primaryBranchId);
  if (primary) return { mode: "branch", branchId: primary.id };

  if (active.length > 0) {
    const [first] = [...active].sort((a, b) => a.code.localeCompare(b.code));
    return { mode: "branch", branchId: first.id };
  }

  return { mode: "all", branchId: null };
}

/** Valor a guardar/leer de la URL (?branch=) y de localStorage — mismo formato para los dos. */
export function scopeToParamValue(scope: InventoryScopeValue): string {
  return scope.mode === "all" ? "all" : (scope.branchId ?? "all");
}
