import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomBytes } from "node:crypto";
import { encryptCameraCredentials, decryptCameraCredentials } from "./credentials-crypto";

const testKey = randomBytes(32);

describe("credentials-crypto: cifrado en reposo de credenciales de cámara", () => {
  it("cifra y descifra de vuelta al mismo texto plano", () => {
    const plaintext = JSON.stringify({ username: "admin", password: "S3cr3t!ñ" });
    const stored = encryptCameraCredentials(plaintext, testKey);
    assert.notEqual(stored, plaintext, "lo guardado nunca debe ser el texto plano");
    assert.equal(decryptCameraCredentials(stored, testKey), plaintext);
  });

  it("cada cifrado usa un IV distinto -- la misma credencial no produce el mismo texto guardado dos veces", () => {
    const plaintext = "admin:admin123";
    const a = encryptCameraCredentials(plaintext, testKey);
    const b = encryptCameraCredentials(plaintext, testKey);
    assert.notEqual(a, b);
    assert.equal(decryptCameraCredentials(a, testKey), plaintext);
    assert.equal(decryptCameraCredentials(b, testKey), plaintext);
  });

  it("un texto cifrado alterado (tag de autenticación no coincide) falla en vez de devolver basura", () => {
    const stored = encryptCameraCredentials("admin:admin123", testKey);
    const [iv, tag, ciphertext] = stored.split(":");
    const tampered = `${iv}:${tag}:${ciphertext.slice(0, -4)}AAAA`;
    assert.throws(() => decryptCameraCredentials(tampered, testKey));
  });

  it("descifrar con la clave equivocada falla", () => {
    const stored = encryptCameraCredentials("admin:admin123", testKey);
    const otherKey = randomBytes(32);
    assert.throws(() => decryptCameraCredentials(stored, otherKey));
  });

  it("formato guardado inválido -> error claro", () => {
    assert.throws(() => decryptCameraCredentials("no-tiene-el-formato-correcto", testKey), /CREDENTIALS_FORMAT_ERROR/);
  });
});
