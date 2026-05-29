"use client";

/**
 * Módulo para gestionar la sucursal activa del usuario.
 *
 * Estrategia:
 * 1. Si el usuario tiene 1 sola sucursal → auto-seleccionar
 * 2. Si tiene 2+ → leer de localStorage, validar que esté en sus branchIds
 * 3. Persistir cambios en localStorage (DB persistence vía UserPreference es futuro)
 */

const STORAGE_KEY = "hammer_active_branch_id";

/**
 * Obtiene el branchId activo del usuario.
 * Prioriza localStorage, luego primaryBranchId, luego branchIds[0].
 */
export function getActiveBranchId(branchIds: string[], primaryBranchId?: string | null): string {
  if (branchIds.length === 0) return "";
  if (branchIds.length === 1) return branchIds[0];

  // Intentar leer de localStorage
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && branchIds.includes(stored)) {
        return stored;
      }
    } catch {
      // localStorage no disponible (SSR, privacidad)
    }
  }

  // Fallback: primaryBranchId o primera sucursal
  if (primaryBranchId && branchIds.includes(primaryBranchId)) {
    return primaryBranchId;
  }

  return branchIds[0];
}

/**
 * Establece la sucursal activa. Guarda en localStorage.
 */
export function setActiveBranchId(branchId: string): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, branchId);
    } catch {
      // silenciar errores de localStorage
    }
  }
}

/**
 * Hook-friendly: retorna true si el usuario tiene más de una sucursal.
 */
export function hasMultipleBranches(branchIds: string[]): boolean {
  return branchIds.length > 1;
}
