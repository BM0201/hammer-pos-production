"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown } from "lucide-react";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import { getActiveBranchId, setActiveBranchId, hasMultipleBranches } from "@/lib/client/active-branch";

type BranchInfo = {
  id: string;
  code: string;
  name: string;
};

type Props = {
  branchIds: string[];
  primaryBranchId?: string | null;
};

/**
 * Selector de sucursal activa.
 * - Si el usuario tiene 1 sucursal → muestra el nombre sin dropdown
 * - Si tiene 2+ → muestra dropdown para cambiar
 * - Al cambiar de sucursal, persiste en localStorage y recarga la página
 */
export function BranchSelector({ branchIds, primaryBranchId }: Props) {
  const router = useRouter();
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [activeBranch, setActiveBranch] = useState<string>(() =>
    getActiveBranchId(branchIds, primaryBranchId)
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Cargar info de sucursales
  useEffect(() => {
    if (branchIds.length === 0) {
      setLoading(false);
      return;
    }

    apiFetch("/api/branches")
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json();
        const data = unwrapApiData(json as ApiResponse<BranchInfo[]>);
        // Filtrar solo las sucursales del usuario
        const userBranches = (Array.isArray(data) ? data : []).filter(
          (b: BranchInfo) => branchIds.includes(b.id)
        );
        setBranches(userBranches);
      })
      .catch(() => {
        // Si falla, crear fallbacks con los IDs
        setBranches(branchIds.map((id) => ({ id, code: id, name: `Sucursal ${id.slice(0, 6)}` })));
      })
      .finally(() => setLoading(false));
  }, [branchIds]);

  const handleSelect = useCallback(
    (branchId: string) => {
      setActiveBranch(branchId);
      setActiveBranchId(branchId);
      setOpen(false);
      // Recargar la página para reflejar el cambio de sucursal
      router.refresh();
      // Forzar recarga completa si estamos en una página de sucursal
      if (typeof window !== "undefined" && window.location.pathname.includes("/branch/")) {
        window.location.reload();
      }
    },
    [router]
  );

  if (branchIds.length === 0 || loading) {
    return null;
  }

  const currentBranch = branches.find((b) => b.id === activeBranch);
  const displayName = currentBranch?.name ?? currentBranch?.code ?? "Sucursal";

  // Solo 1 sucursal → mostrar sin dropdown
  if (!hasMultipleBranches(branchIds)) {
    return (
      <div
        className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-muted)]"
        title={displayName}
      >
        <Building2 className="h-3.5 w-3.5 text-[var(--color-info-700)]" />
        <span className="max-w-[120px] truncate">{displayName}</span>
      </div>
    );
  }

  // Múltiples sucursales → dropdown
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text)] shadow-sm transition-colors hover:border-[var(--color-info-300)] hover:bg-[var(--color-surface)]"
        title="Cambiar sucursal activa"
      >
        <Building2 className="h-3.5 w-3.5 text-[var(--color-info-700)]" />
        <span className="max-w-[120px] truncate">{displayName}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          {/* Overlay para cerrar al hacer clic fuera */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 min-w-[220px] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-xl">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Sucursal activa
            </div>
            {branches.map((branch) => (
              <button
                key={branch.id}
                type="button"
                onClick={() => handleSelect(branch.id)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  branch.id === activeBranch
                    ? "bg-[var(--color-info-50)] text-[var(--color-info-800)] font-semibold"
                    : "text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]"
                }`}
              >
                <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
                <div className="flex flex-col">
                  <span>{branch.name}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">{branch.code}</span>
                </div>
                {branch.id === activeBranch && (
                  <span className="ml-auto h-2 w-2 rounded-full bg-[var(--color-success-600)]" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
