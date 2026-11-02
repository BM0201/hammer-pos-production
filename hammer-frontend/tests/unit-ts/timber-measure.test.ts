import assert from "node:assert/strict";
import test from "node:test";
import { parseTimberMeasure } from "@/components/timber/timber-measure";

test("entrada rápida: acepta como la escribe la gente", () => {
  const expected = { thickness: 1, width: 12, length: 16 };
  for (const text of ["1x12x16", "1X12X16", "1 X 12 X 16", "1 12 16", "1×12×16", " 1*12*16 "]) {
    assert.deepEqual(parseTimberMeasure(text), expected, text);
  }
});

test("entrada rápida: un largo de 3 a 6 son varas, como en el catálogo", () => {
  assert.deepEqual(parseTimberMeasure("2x4x6"), { thickness: 2, width: 4, length: 16 });
  assert.deepEqual(parseTimberMeasure("1x6x3"), { thickness: 1, width: 6, length: 8 });
  assert.deepEqual(parseTimberMeasure("2x8x15"), { thickness: 2, width: 8, length: 15 });
});

test("entrada rápida: lo que no es una medida no se agrega", () => {
  for (const text of ["", "1x12", "tabla", "0x12x16", "1x12x16x2"]) {
    assert.equal(parseTimberMeasure(text), null, text);
  }
});
