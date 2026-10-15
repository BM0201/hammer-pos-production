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

function isValidGtinLength(length: number): boolean {
  return length === 8 || length === 12 || length === 13;
}

/**
 * prompt-codigos-editar-eliminar.md Fase 1.1 — espejo EXACTO de
 * isValidGtinChecksum en hammer-frontend/src/lib/scanner.ts (mismos casos de
 * prueba en barcode.test.ts que ese archivo, para que no se desincronicen en
 * silencio). Dígito verificador GTIN-8/12/13: pesos 3/1 alternados desde el
 * dígito MENOS significativo del payload.
 */
export function isValidGtinChecksum(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (!isValidGtinLength(code.length)) return false;
  const payload = code.slice(0, -1);
  const checkDigit = Number(code[code.length - 1]);
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const posFromRight = payload.length - 1 - i;
    const weight = posFromRight % 2 === 0 ? 3 : 1;
    sum += Number(payload[i]) * weight;
  }
  const expectedCheck = (10 - (sum % 10)) % 10;
  return expectedCheck === checkDigit;
}

/**
 * prompt-codigos-editar-eliminar.md Fase 1.1 — espejo EXACTO de
 * expandUpcEToUpcA en hammer-frontend/src/lib/scanner.ts. Expande un UPC-E
 * (6 dígitos comprimidos, o 8 con número de sistema + verificador incluidos)
 * a su UPC-A equivalente (12 dígitos), algoritmo GS1 de zero-suppression.
 * Solo sistema "0"/"1"; el verificador del resultado se RECALCULA siempre.
 */
export function expandUpcEToUpcA(upcE: string): string | null {
  if (!/^\d+$/.test(upcE)) return null;
  let core: string;
  let systemDigit = "0";
  if (upcE.length === 8) {
    systemDigit = upcE[0];
    if (systemDigit !== "0" && systemDigit !== "1") return null;
    core = upcE.slice(1, 7);
  } else if (upcE.length === 6) {
    core = upcE;
  } else {
    return null;
  }
  const lastDigit = core[5];
  const mfr = core.slice(0, 5);
  let body: string;
  switch (lastDigit) {
    case "0": case "1": case "2":
      body = `${mfr.slice(0, 2)}${lastDigit}0000${mfr.slice(2)}`;
      break;
    case "3":
      body = `${mfr.slice(0, 3)}00000${mfr.slice(3)}`;
      break;
    case "4":
      body = `${mfr.slice(0, 4)}00000${mfr.slice(4)}`;
      break;
    default:
      body = `${mfr.slice(0, 5)}0000${lastDigit}`;
      break;
  }
  const payload = `${systemDigit}${body}`;
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const posFromRight = payload.length - 1 - i;
    const weight = posFromRight % 2 === 0 ? 3 : 1;
    sum += Number(payload[i]) * weight;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return `${payload}${checkDigit}`;
}

/**
 * "Si tiene forma de EAN-13, EAN-8, UPC-A o UPC-E y el dígito verificador
 * falla → aviso" (Fase 1.1). Un largo de 8 dígitos es AMBIGUO (puede ser un
 * EAN-8 real, autocontenido, o un UPC-E con sistema+verificador ya
 * incluidos, que necesita expandirse primero) — sin el formato que reportó
 * el lector (ya perdido para un código guardado), alcanza con que UNA
 * interpretación cuadre para no avisar de más sobre un código que sí es
 * válido. Un código que no tiene pinta de ninguno de estos (letras, otro
 * largo — p.ej. un SUPPLIER interno o un QR) no genera aviso: no hay nada
 * que verificar.
 */
export function checksumWarningForCode(code: string): "CHECKSUM_INVALID" | null {
  if (!/^\d+$/.test(code)) return null;
  if (code.length === 12 || code.length === 13) {
    return isValidGtinChecksum(code) ? null : "CHECKSUM_INVALID";
  }
  if (code.length === 8) {
    if (isValidGtinChecksum(code)) return null; // EAN-8 autocontenido, válido tal cual.
    const expanded = expandUpcEToUpcA(code);
    if (expanded && isValidGtinChecksum(expanded)) return null; // UPC-E de 8 (sistema+verificador), válido una vez expandido.
    return "CHECKSUM_INVALID";
  }
  if (code.length === 6) {
    const expanded = expandUpcEToUpcA(code);
    return expanded && isValidGtinChecksum(expanded) ? null : "CHECKSUM_INVALID";
  }
  return null;
}
