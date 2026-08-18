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

/**
 * prompt-correccion-dialogo-cobro.md prueba 1 + el problema que describe:
 * el compositor se agregó ENCIMA de las pestañas, no en su reemplazo — el
 * componente tenía SingleLineEditor (con su propio selector de método tipo
 * pestaña, onMethodChange) coexistiendo con los botones "+ método" del
 * compositor. Se borró: no se oculta, no queda como atajo.
 */
test("payment-composer.tsx no tiene un selector de método tipo pestaña coexistiendo con los botones de agregar línea", () => {
  const c = read("components/payments/payment-composer.tsx");
  assert.ok(!c.includes("function SingleLineEditor") && !c.includes("<SingleLineEditor"), "el editor de caso único con pestañas de método debe estar borrado, no oculto (se permite mencionarlo en un comentario explicando por qué se borró)");
  assert.ok(!c.includes("onMethodChange"), "no debe quedar un callback para cambiar el método de la línea actual");
  assert.ok(!c.includes("changeSingleLineMethod"), "no debe quedar la función que cambiaba el método de la única línea");
  // Sí debe quedar la única manera de fijar el método: agregar una línea de ese método.
  assert.ok(c.includes("function addLine"), "agregar una línea es la única forma de fijar su método");
});

/**
 * prompt-correccion-dialogo-cobro.md §2.5/prueba 11: "en un mostrador el
 * botón de confirmar no puede estar fuera de pantalla" — verificación
 * estructural (no hay DOM/render en este repo) de que la maqueta de tres
 * zonas está en el código: el diálogo tiene alto máximo con flex-col, y
 * PaymentComposer separa la lista (con scroll) del pie fijo.
 */
test("charge-dialog.tsx tiene alto máximo con estructura de tres zonas (encabezado fijo, cuerpo con scroll)", () => {
  const c = read("components/pos/components/charge-dialog.tsx");
  assert.match(c, /max-h-\[85vh\]/, "el diálogo debe tener alto máximo — el pie no puede quedar fuera de pantalla");
  assert.ok(c.includes("flex-col"), "estructura de columna para separar encabezado fijo del cuerpo con scroll");
});

test("payment-composer.tsx separa la lista de líneas (con scroll) del pie fijo (agregar + confirmar)", () => {
  const c = read("components/payments/payment-composer.tsx");
  assert.ok(c.includes("overflow-y-auto"), "la lista de líneas debe ser el único área con scroll");
  assert.ok(c.includes("flex-none space-y-2 pt-3"), "el pie (agregar método + confirmar) debe quedar fuera del área con scroll, en su propia zona fija");
  assert.ok(c.includes('data-testid="payment-composer-confirm"'), "el botón de confirmar debe seguir siendo ubicable");
});
