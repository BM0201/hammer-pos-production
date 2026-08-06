import { randomBytes } from "node:crypto";

const UPPER   = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sin I, O
const LOWER   = "abcdefghjkmnpqrstuvwxyz";  // sin i, o, l
const DIGITS  = "23456789";                  // sin 0, 1
const SYMBOLS = "!@#$%^&*-_=+";
const ALL     = UPPER + LOWER + DIGITS + SYMBOLS;

/** Entero seguro sin sesgo de módulo en [0, max). */
function secureInt(max: number): number {
  const ceiling = 256 - (256 % max);
  let byte: number;
  do {
    byte = randomBytes(1)[0];
  } while (byte >= ceiling);
  return byte % max;
}

/**
 * Genera una contraseña temporal criptográficamente segura de 16 caracteres.
 * Garantiza: ≥1 mayúscula, ≥1 minúscula, ≥1 dígito, ≥1 símbolo.
 * Nunca se almacena en BD — solo se devuelve una vez al administrador.
 */
export function generateTempPassword(): string {
  const parts: string[] = [
    UPPER[secureInt(UPPER.length)],
    LOWER[secureInt(LOWER.length)],
    DIGITS[secureInt(DIGITS.length)],
    SYMBOLS[secureInt(SYMBOLS.length)],
  ];
  for (let i = 0; i < 12; i++) {
    parts.push(ALL[secureInt(ALL.length)]);
  }

  // Fisher-Yates shuffle sin sesgo
  for (let i = parts.length - 1; i > 0; i--) {
    const j = secureInt(i + 1);
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }

  return parts.join("");
}
