/** Varas → largo en pies. shortcut: tabla por defecto, no la config por sucursal; si cambia la cubicación, leerla del API. */
const VARAS_TO_FEET: Record<number, number> = { 3: 8, 4: 11, 5: 14, 6: 16 };

/**
 * "1x12x16", "1 X 12 X 16", "1 12 16" o "1×12×16". Un largo de 3 a 6 son varas,
 * como en el nombre del catálogo: "2x4x6" es el CUARTON 2X4X6, o sea 2×4×16 pies.
 */
export function parseTimberMeasure(text: string): { thickness: number; width: number; length: number } | null {
  const match = text.trim().match(/^(\d+)\s*[xX×*\s]\s*(\d+)\s*[xX×*\s]\s*(\d+)$/);
  if (!match) return null;
  const [thickness, width, length] = match.slice(1).map(Number);
  if (!thickness || !width || !length) return null;
  return { thickness, width, length: VARAS_TO_FEET[length] ?? length };
}
