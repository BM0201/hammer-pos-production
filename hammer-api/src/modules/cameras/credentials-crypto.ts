/**
 * Cifrado de credenciales de cámara (usuario/contraseña ONVIF/RTSP) en
 * reposo — el prompt del módulo lo exige explícitamente: "las credenciales
 * viven cifradas en el servidor". AES-256-GCM: IV aleatorio por cada
 * cifrado, tag de autenticación (una credencial alterada o truncada falla
 * al desencriptar, no devuelve basura en silencio).
 *
 * Formato almacenado: "<iv-b64>:<tag-b64>:<ciphertext-b64>".
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function loadKey(): Buffer {
  const raw = process.env.CAMERA_CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) throw new Error("CONFIG_ERROR: falta CAMERA_CREDENTIALS_ENCRYPTION_KEY");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CONFIG_ERROR: CAMERA_CREDENTIALS_ENCRYPTION_KEY debe decodificar a 32 bytes (AES-256)");
  return key;
}

export function encryptCameraCredentials(plaintext: string, key: Buffer = loadKey()): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptCameraCredentials(stored: string, key: Buffer = loadKey()): string {
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("CREDENTIALS_FORMAT_ERROR: formato cifrado inválido");
  const [ivB64, tagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Genera una clave nueva de 32 bytes en base64 — utilidad para provisionar CAMERA_CREDENTIALS_ENCRYPTION_KEY una sola vez. */
export function generateCameraCredentialsKey(): string {
  return randomBytes(32).toString("base64");
}
