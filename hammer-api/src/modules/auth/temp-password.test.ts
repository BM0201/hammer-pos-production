import { test } from "node:test";
import assert from "node:assert/strict";
import { generateTempPassword } from "@/modules/auth/temp-password";

test("generateTempPassword: 16 caracteres", () => {
  const pwd = generateTempPassword();
  assert.equal(pwd.length, 16);
});

test("generateTempPassword: contiene al menos una mayúscula", () => {
  const pwd = generateTempPassword();
  assert.ok(/[A-Z]/.test(pwd), `esperaba mayúscula en "${pwd}"`);
});

test("generateTempPassword: contiene al menos una minúscula", () => {
  const pwd = generateTempPassword();
  assert.ok(/[a-z]/.test(pwd), `esperaba minúscula en "${pwd}"`);
});

test("generateTempPassword: contiene al menos un dígito", () => {
  const pwd = generateTempPassword();
  assert.ok(/[0-9]/.test(pwd), `esperaba dígito en "${pwd}"`);
});

test("generateTempPassword: contiene al menos un símbolo", () => {
  const pwd = generateTempPassword();
  assert.ok(/[!@#$%^&*\-_=+]/.test(pwd), `esperaba símbolo en "${pwd}"`);
});

test("generateTempPassword: no contiene caracteres ambiguos I O i l o 0 1", () => {
  for (let i = 0; i < 50; i++) {
    const pwd = generateTempPassword();
    assert.ok(!/[IOilo01]/.test(pwd), `"${pwd}" contiene caracter ambiguo`);
  }
});

test("generateTempPassword: 100 contraseñas son todas distintas", () => {
  const passwords = new Set(Array.from({ length: 100 }, () => generateTempPassword()));
  assert.equal(passwords.size, 100);
});

test("generateTempPassword: no es ElChele1234! ni variante", () => {
  for (let i = 0; i < 20; i++) {
    const pwd = generateTempPassword();
    assert.notEqual(pwd, "ElChele1234!");
    assert.notEqual(pwd.toLowerCase(), "elchele1234!");
  }
});
