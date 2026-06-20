/**
 * TOTP — Time-based One-Time Password (RFC 6238 / RFC 4226)
 *
 * Implementación pura con Node.js crypto — sin dependencias externas.
 * Algoritmo: HMAC-SHA1, 6 dígitos, período 30s, ventana ±1 período (tolerancia de 60s).
 *
 * RIESGO DOCUMENTADO: mfaSecret se almacena como base32 en texto plano en BD.
 * Para producción de alta seguridad, cifrar con AES-256-GCM usando MFA_ENCRYPTION_KEY.
 * Estructura de cifrado preparada — implementar cuando se establezca la clave.
 */

import { createHmac, randomBytes } from "node:crypto";

// ─── Base32 ──────────────────────────────────────────────────────────────────

const B32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += B32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += B32_CHARS[(value << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(str: string): Buffer {
  const s = str.toUpperCase().replace(/=+$/, "");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of s) {
    const idx = B32_CHARS.indexOf(char);
    if (idx === -1) throw new Error(`TOTP_INVALID_SECRET: char '${char}' inválido en base32`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ─── HOTP (RFC 4226) ─────────────────────────────────────────────────────────

function hotp(secret: string, counter: bigint): string {
  const key = decodeBase32(secret);
  const msg = Buffer.alloc(8);
  // Write counter as big-endian uint64
  msg.writeBigUInt64BE(counter);
  const hmac = createHmac("sha1", key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

// ─── TOTP (RFC 6238) ─────────────────────────────────────────────────────────

const PERIOD = 30;   // seconds
const WINDOW = 1;    // allow ±1 period (= 90s clock skew tolerance)
const DIGITS = 6;

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20)); // 160-bit secret
}

/**
 * Verifica un código TOTP con ventana ±WINDOW períodos.
 * Devuelve true si el código es válido.
 */
export function verifyTotp(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const T = BigInt(Math.floor(Date.now() / 1000 / PERIOD));
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    if (hotp(secret, T + BigInt(delta)) === code) return true;
  }
  return false;
}

/**
 * Genera el código TOTP actual (para tests/debugging, no exponer en producción).
 */
export function getCurrentTotp(secret: string): string {
  const T = BigInt(Math.floor(Date.now() / 1000 / PERIOD));
  return hotp(secret, T);
}

// ─── OTPAuth URI ─────────────────────────────────────────────────────────────

export function buildOtpauthUri(params: {
  secret: string;
  username: string;
  issuer?: string;
}): string {
  const issuer = params.issuer ?? "Hammer POS";
  const label = encodeURIComponent(`${issuer}:${params.username}`);
  return (
    `otpauth://totp/${label}` +
    `?secret=${params.secret}` +
    `&issuer=${encodeURIComponent(issuer)}` +
    `&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`
  );
}

// ─── Recovery codes ───────────────────────────────────────────────────────────

import { createHash } from "node:crypto";

const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_LENGTH = 10; // chars (alphanumeric)
const RC_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRecoveryCodes(): { plain: string[]; hashed: string[] } {
  const plain: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const bytes = randomBytes(RECOVERY_CODE_LENGTH);
    const code = Array.from(bytes)
      .map((b) => RC_CHARS[b % RC_CHARS.length])
      .join("");
    plain.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  const hashed = plain.map((c) =>
    createHash("sha256").update(c.replace("-", "")).digest("hex"),
  );
  return { plain, hashed };
}

export function verifyRecoveryCode(
  plainCode: string,
  hashedCodes: string[],
): { valid: boolean; remainingCodes: string[] } {
  const normalized = plainCode.replace(/[-\s]/g, "").toUpperCase();
  const hash = createHash("sha256").update(normalized).digest("hex");
  const idx = hashedCodes.indexOf(hash);
  if (idx === -1) return { valid: false, remainingCodes: hashedCodes };
  const remainingCodes = hashedCodes.filter((_, i) => i !== idx);
  return { valid: true, remainingCodes };
}
