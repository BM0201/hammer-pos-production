import { randomBytes, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { hashSync as argon2HashSync, verifySync as argon2VerifySync } from "@node-rs/argon2";

/**
 * Hashing de contraseñas.
 *
 * Formato actual: Argon2id (memory-hard, resistente a fuerza bruta con GPU).
 * Formato legado: PBKDF2-SHA512 210k iteraciones (`pbkdf2$...`). Los hashes
 * legados siguen verificando; la migración es perezosa: tras un login exitoso
 * con hash PBKDF2, `authenticate()` re-hashea a Argon2id con la contraseña
 * que el usuario acaba de escribir (ver `needsRehash`).
 *
 * Parámetros Argon2id (OWASP Password Storage Cheat Sheet 2024, primer
 * preset recomendado): m=19 MiB, t=2, p=1. Elegidos por el límite de
 * memoria de las funciones serverless de Vercel (1 GB por invocación en el
 * plan actual, pero varias invocaciones concurrentes comparten la instancia):
 * 19 MiB por hash mantiene el costo de memoria acotado con ~50-80 ms de CPU,
 * comparable al costo del PBKDF2 anterior pero memory-hard.
 */
const ARGON2_OPTIONS = {
  // 2 = Algorithm.Argon2id (const enum ambiente de @node-rs/argon2, no
  // importable con isolatedModules; el test verifica el prefijo $argon2id$)
  algorithm: 2,
  memoryCost: 19_456, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_KEY_LENGTH = 32;
const PBKDF2_DIGEST = "sha512";

/** Hashea con Argon2id — usar para toda contraseña nueva o reseteada. */
export function hashPassword(plainPassword: string): string {
  return argon2HashSync(plainPassword, ARGON2_OPTIONS);
}

/**
 * Hashea con el formato legado PBKDF2. Solo para tests de compatibilidad y
 * rollback de emergencia — el código de producción usa `hashPassword()`.
 * @deprecated
 */
export function hashPasswordLegacyPbkdf2(plainPassword: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(plainPassword, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST).toString("hex");
  return `pbkdf2$${PBKDF2_ITERATIONS}$${PBKDF2_DIGEST}$${salt}$${hash}`;
}

function verifyPasswordPbkdf2(plainPassword: string, storedHash: string): boolean {
  const [algo, iterRaw, digest, salt, hash] = storedHash.split("$");
  if (algo !== "pbkdf2" || !iterRaw || !digest || !salt || !hash) {
    return false;
  }

  const iterations = Number(iterRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }

  const candidate = pbkdf2Sync(plainPassword, salt, iterations, PBKDF2_KEY_LENGTH, digest).toString("hex");
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(hash, "hex");

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

function verifyPasswordArgon2id(plainPassword: string, storedHash: string): boolean {
  try {
    return argon2VerifySync(storedHash, plainPassword);
  } catch {
    return false;
  }
}

/** Verifica contra el formato almacenado: PHC Argon2 (`$argon2id$...`) o legado (`pbkdf2$...`). */
export function verifyPassword(plainPassword: string, storedHash: string): boolean {
  if (storedHash.startsWith("$argon2")) {
    return verifyPasswordArgon2id(plainPassword, storedHash);
  }
  return verifyPasswordPbkdf2(plainPassword, storedHash);
}

/** True si el hash almacenado usa el formato legado y debe re-hashearse a Argon2id. */
export function needsRehash(storedHash: string): boolean {
  return !storedHash.startsWith("$argon2");
}
