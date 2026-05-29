import { randomBytes, pbkdf2Sync, timingSafeEqual } from "node:crypto";

const ITERATIONS = 210_000;
const KEY_LENGTH = 32;
const DIGEST = "sha512";

export function hashPassword(plainPassword: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(plainPassword, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
  return `pbkdf2$${ITERATIONS}$${DIGEST}$${salt}$${hash}`;
}

export function verifyPassword(plainPassword: string, storedHash: string): boolean {
  const [algo, iterRaw, digest, salt, hash] = storedHash.split("$");
  if (algo !== "pbkdf2" || !iterRaw || !digest || !salt || !hash) {
    return false;
  }

  const iterations = Number(iterRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }

  const candidate = pbkdf2Sync(plainPassword, salt, iterations, KEY_LENGTH, digest).toString("hex");
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(hash, "hex");

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}
