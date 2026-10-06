/**
 * prompt-alta-productos-qr.md Fase 1 — funciones puras para códigos de
 * barra/QR (sin DB), testeables en aislamiento.
 */

/**
 * Normaliza un código escaneado o tecleado: trim + sin espacios internos.
 * Espejo documentado de la regla de lib/scanner.ts (lector de cámara,
 * prompt aparte, todavía no implementado) — ambos lados deben aplicar
 * EXACTAMENTE la misma regla sin importar cuál se implemente primero.
 */
export function normalizeScannedCode(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

/**
 * Código interno para productos sin código de fábrica (madera, hierro,
 * producidos). Prefijo HMR- para no chocar con EAN/UPC (solo dígitos).
 * Estable: depende del SKU ya asignado, no se mueve si el producto se
 * renombra después.
 */
export function buildInternalBarcode(sku: string): string {
  return `HMR-${sku}`;
}
