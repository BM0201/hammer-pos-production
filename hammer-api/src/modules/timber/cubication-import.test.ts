import assert from "node:assert/strict";
import test from "node:test";
import { parseCubicationMatrix } from "@/modules/timber/service";

/**
 * prompt-timber-cubicacion-carga.md, Parte B — el usuario SIEMPRE
 * recuenta a mano guiándose por su propia hoja tipo
 * "CUBICACION_DE_VIAJE.xlsx" (hoja "Simple", columna A "MEDIDA" con
 * strings tipo "1 X 12 X16" / "2 x 4 x 11" — mayúsculas/espacios
 * inconsistentes —, columna B "PIEZAS", fila "TOTALES" al final que hay
 * que ignorar; columna C "PIES" NO se debe confiar, recalcular siempre
 * server-side con la fórmula propia).
 *
 * parseCubicationMatrix es la parte pura (sin DB) de
 * previewTimberCubicationImport — matrix ya viene de readExcelBase64,
 * existingByKey ya viene de trip.lines.
 */

function matrix(rows: string[][]): string[][] {
  return [["MEDIDA", "PIEZAS", "PIES"], ...rows];
}

test("Test LA QUE IMPORTA — tolera mayúsculas y espacios inconsistentes: '1 X 12 X16' y '2 x 4 x 11'", () => {
  const { recognized, unrecognized } = parseCubicationMatrix(
    matrix([
      ["1 X 12 X16", "5", "999"], // sin espacio entre la segunda X y el largo — a propósito, tal como lo manda el aserradero
      ["2 x 4 x 11", "3", "999"], // minúsculas
    ]),
    new Map(),
  );
  assert.equal(unrecognized.length, 0);
  assert.equal(recognized.length, 2);
  const first = recognized.find((r) => r.thickness === 1 && r.width === 12 && r.length === 16);
  const second = recognized.find((r) => r.thickness === 2 && r.width === 4 && r.length === 11);
  assert.ok(first && second, "ambas medidas deben reconocerse pese al formato inconsistente");
  assert.equal(first!.pieces, 5);
  assert.equal(second!.pieces, 3);
});

test("Test LA QUE IMPORTA — la columna PIES del archivo NUNCA se usa, se recalcula con la fórmula propia (thickness×width×length×pieces/12)", () => {
  const { recognized } = parseCubicationMatrix(
    matrix([["2 X 4 X 8", "10", "999999"]]), // PIES del archivo es una trampa deliberada — debe ignorarse
    new Map(),
  );
  assert.equal(recognized.length, 1);
  // (2 × 4 × 8 × 10) / 12 = 53.3333...
  assert.equal(recognized[0].calculatedFeet, Math.round(((2 * 4 * 8 * 10) / 12 + Number.EPSILON) * 10000) / 10000);
  assert.notEqual(recognized[0].calculatedFeet, 999999);
});

test("fila TOTALES se ignora en silencio — no es una medida no reconocida", () => {
  const { recognized, unrecognized } = parseCubicationMatrix(
    matrix([
      ["1 X 12 X 16", "5", "10"],
      ["TOTALES", "5", "10"],
      ["Totales", "5", "10"],
    ]),
    new Map(),
  );
  assert.equal(recognized.length, 1);
  assert.equal(unrecognized.length, 0, "TOTALES no debe aparecer como fila no reconocida");
});

test("fila en blanco (MEDIDA vacía) se ignora en silencio", () => {
  const { recognized, unrecognized } = parseCubicationMatrix(
    matrix([
      ["", "", ""],
      ["1 X 12 X 16", "5", "10"],
    ]),
    new Map(),
  );
  assert.equal(recognized.length, 1);
  assert.equal(unrecognized.length, 0);
});

test("medida con formato no reconocible va a 'no reconocidas' con motivo, no rompe el resto del archivo", () => {
  const { recognized, unrecognized } = parseCubicationMatrix(
    matrix([
      ["madera rara", "5", "10"],
      ["1 X 12 X 16", "3", "10"],
    ]),
    new Map(),
  );
  assert.equal(recognized.length, 1, "la fila siguiente, bien formada, sí debe procesarse");
  assert.equal(unrecognized.length, 1);
  assert.equal(unrecognized[0].rawMedida, "madera rara");
  assert.match(unrecognized[0].reason, /formato de medida/i);
});

test("piezas vacío, cero o no numérico va a 'no reconocidas' con motivo distinto", () => {
  const { unrecognized } = parseCubicationMatrix(
    matrix([
      ["1 X 12 X 16", "0", "10"],
      ["1 X 12 X 14", "", "10"],
      ["1 X 12 X 11", "abc", "10"],
    ]),
    new Map(),
  );
  assert.equal(unrecognized.length, 3);
  for (const row of unrecognized) assert.match(row.reason, /piezas/i);
});

test("medida que YA existe en el viaje → action UPDATE con existingPieces; medida nueva → action CREATE con existingPieces null", () => {
  const existingByKey = new Map([["1x12x16", 20]]);
  const { recognized } = parseCubicationMatrix(
    matrix([
      ["1 X 12 X 16", "5", "10"], // ya existía con 20 piezas
      ["2 X 4 X 8", "3", "10"], // nueva
    ]),
    existingByKey,
  );
  const existing = recognized.find((r) => r.thickness === 1 && r.width === 12 && r.length === 16)!;
  const fresh = recognized.find((r) => r.thickness === 2 && r.width === 4 && r.length === 8)!;
  assert.equal(existing.action, "UPDATE");
  assert.equal(existing.existingPieces, 20);
  assert.equal(fresh.action, "CREATE");
  assert.equal(fresh.existingPieces, null);
});

test("la misma medida repetida en varias filas del archivo (tarima/atado separados) suma las piezas en una sola entrada", () => {
  const { recognized } = parseCubicationMatrix(
    matrix([
      ["1 X 12 X 16", "5", "10"],
      ["1 X 12 X 16", "3", "10"],
      ["1 X 12 X 16", "2", "10"],
    ]),
    new Map(),
  );
  assert.equal(recognized.length, 1, "no debe haber 3 líneas separadas para la misma medida");
  assert.equal(recognized[0].pieces, 10, "5+3+2");
});

test("columnas MEDIDA/PIEZAS no encontradas → CUBICATION_COLUMNS_NOT_FOUND", () => {
  assert.throws(
    () => parseCubicationMatrix([["Columna A", "Columna B"], ["x", "y"]], new Map()),
    /CUBICATION_COLUMNS_NOT_FOUND/,
  );
});

test("archivo vacío (solo encabezado o nada) → EMPTY_CUBICATION_FILE", () => {
  assert.throws(() => parseCubicationMatrix([["MEDIDA", "PIEZAS"]], new Map()), /EMPTY_CUBICATION_FILE/);
  assert.throws(() => parseCubicationMatrix([], new Map()), /EMPTY_CUBICATION_FILE/);
});

test("acepta alias razonables de encabezado (Cantidad en vez de Piezas, Dimensiones en vez de Medida)", () => {
  const { recognized } = parseCubicationMatrix(
    [["Dimensiones", "Cantidad"], ["1 X 12 X 16", "5"]],
    new Map(),
  );
  assert.equal(recognized.length, 1);
});
