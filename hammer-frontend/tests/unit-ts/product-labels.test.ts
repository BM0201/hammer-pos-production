import assert from "node:assert/strict";
import test from "node:test";
import { buildLabelsHtml, type LabelProductInput } from "@/lib/product-labels";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const BASE_PRODUCT: LabelProductInput = {
  name: "Cemento Canal",
  sku: "GEN-0001",
  barcode: "7501234567890",
  standardSalePrice: 350,
};

test("escapa el HTML del nombre del producto", () => {
  const html = buildLabelsHtml(
    [{ ...BASE_PRODUCT, name: '<script>alert("x")</script> & Cia' }],
    { paperWidth: "W80MM", copies: 1, showPrice: true },
  );
  assert.ok(!html.includes("<script>alert"), "no debe incrustar el tag crudo");
  assert.ok(html.includes("&lt;script&gt;"), "el nombre escapado debe aparecer");
  assert.ok(html.includes("&amp; Cia") || html.includes("&amp;"), "el & también se escapa");
});

test("respeta la cantidad de copias pedidas", () => {
  const html = buildLabelsHtml([BASE_PRODUCT], { paperWidth: "W80MM", copies: 3, showPrice: true });
  assert.equal(countOccurrences(html, 'class="label"'), 3);
});

test("copies menor a 1 se trata como 1 (nunca cero etiquetas)", () => {
  const html = buildLabelsHtml([BASE_PRODUCT], { paperWidth: "W80MM", copies: 0, showPrice: true });
  assert.equal(countOccurrences(html, 'class="label"'), 1);
});

test("showPrice:false oculta el precio", () => {
  // Busca el DIV realmente usado, no la regla CSS .label-price (esa vive en
  // el <style> siempre, se use o no — eso es correcto, no un bug).
  const htmlWithPrice = buildLabelsHtml([BASE_PRODUCT], { paperWidth: "W80MM", copies: 1, showPrice: true });
  const htmlWithoutPrice = buildLabelsHtml([BASE_PRODUCT], { paperWidth: "W80MM", copies: 1, showPrice: false });
  assert.ok(htmlWithPrice.includes('<div class="label-price">'));
  assert.ok(htmlWithPrice.includes("350.00"));
  assert.ok(!htmlWithoutPrice.includes('<div class="label-price">'));
  assert.ok(!htmlWithoutPrice.includes("350.00"));
});

test("un producto sin barcode no genera ninguna etiqueta", () => {
  const html = buildLabelsHtml(
    [{ ...BASE_PRODUCT, barcode: null }],
    { paperWidth: "W80MM", copies: 2, showPrice: true },
  );
  assert.equal(countOccurrences(html, 'class="label"'), 0);
});

test("mezcla de productos con y sin barcode: solo imprime los que tienen código", () => {
  const html = buildLabelsHtml(
    [BASE_PRODUCT, { ...BASE_PRODUCT, sku: "GEN-0002", barcode: null }, { ...BASE_PRODUCT, sku: "GEN-0003" }],
    { paperWidth: "W80MM", copies: 1, showPrice: true },
  );
  assert.equal(countOccurrences(html, 'class="label"'), 2);
  assert.ok(!html.includes("GEN-0002"));
});

test("el QR mide al menos 20mm (exigencia de lectura con camara de tablet)", () => {
  const html = buildLabelsHtml([BASE_PRODUCT], { paperWidth: "W58MM", copies: 1, showPrice: true });
  const match = html.match(/width="(\d+(?:\.\d+)?)mm" height="(\d+(?:\.\d+)?)mm" shape-rendering/);
  assert.ok(match, "debe encontrar el SVG del QR con sus dimensiones en mm");
  assert.ok(Number(match![1]) >= 20);
  assert.ok(Number(match![2]) >= 20);
});

test("paperWidth W58MM vs W80MM cambia el ancho de la etiqueta", () => {
  const html58 = buildLabelsHtml([BASE_PRODUCT], { paperWidth: "W58MM", copies: 1, showPrice: true });
  const html80 = buildLabelsHtml([BASE_PRODUCT], { paperWidth: "W80MM", copies: 1, showPrice: true });
  assert.ok(html58.includes("width: 58mm"));
  assert.ok(html80.includes("width: 80mm"));
});
