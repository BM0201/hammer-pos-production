/**
 * correccion-destino-y-pantalla-cobro.md §2.4 / prueba 8: el diálogo de
 * cobro del POS y la cola de cajero tienen que usar el MISMO componente de
 * composición de pago — si no, uno acepta mixtos y el otro no, y nadie sabe
 * cuál usar para qué. Test estructural (lee el código fuente), sin backend
 * ni render — misma convención que critical-files.test.mjs.
 *
 * Ejecutar: npm run test:unit
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "..", "..", "src");

function read(rel) {
  const abs = join(SRC, rel);
  assert.ok(existsSync(abs), `Archivo no existe: ${rel}`);
  return readFileSync(abs, "utf8");
}

test("payment-composer.tsx existe y expone PaymentComposer", () => {
  const c = read("components/payments/payment-composer.tsx");
  assert.ok(c.includes("export function PaymentComposer"), "debe exportar PaymentComposer");
});

test("charge-dialog.tsx (POS) usa el PaymentComposer compartido, no su propia lógica de tabs excluyentes", () => {
  const c = read("components/pos/components/charge-dialog.tsx");
  assert.ok(c.includes('from "@/components/payments/payment-composer"'), "debe importar el composer compartido");
  assert.ok(c.includes("<PaymentComposer"), "debe renderizarlo");
  assert.ok(!c.includes('type PaymentTab = "CASH" | "CARD" | "TRANSFER"'), "no debe quedar el modelo viejo de pestañas excluyentes");
});

test("cashier-payments.tsx (cola de cajero) usa el mismo PaymentComposer compartido", () => {
  const c = read("components/payments/cashier-payments.tsx");
  assert.ok(c.includes('from "@/components/payments/payment-composer"'), "debe importar el composer compartido");
  assert.ok(c.includes("<PaymentComposer"), "debe renderizarlo");
});

test("ambos consumidores importan del mismo path — no hay una segunda copia divergente", () => {
  const dialog = read("components/pos/components/charge-dialog.tsx");
  const cashier = read("components/payments/cashier-payments.tsx");
  const importLine = 'from "@/components/payments/payment-composer"';
  assert.ok(dialog.includes(importLine) && cashier.includes(importLine));
});
