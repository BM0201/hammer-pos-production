/**
 * prompt-carga-precios.md Fase 3 — navegación tipo planilla en la grilla de
 * la carga de precios: Enter o ↓ bajan a la misma columna de la fila
 * siguiente (como Excel), ↑ sube. Pura y sin DOM para poder probarla sin
 * montar el componente — el componente solo hace focus() con el índice que
 * esto devuelve.
 */
export type GridNavKey = "Enter" | "ArrowDown" | "ArrowUp";

/** null = no hay a dónde moverse (ya es la primera/última fila, o la grilla está vacía). */
export function nextGridRowIndex(currentIndex: number, totalRows: number, key: GridNavKey): number | null {
  if (totalRows <= 0) return null;

  if (key === "Enter" || key === "ArrowDown") {
    return currentIndex + 1 < totalRows ? currentIndex + 1 : null;
  }
  return currentIndex - 1 >= 0 ? currentIndex - 1 : null;
}
