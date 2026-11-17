/** Carga de la cubicación desde el Excel del aserradero (hoja "Simple"): solo vista previa, no escribe. */
import { prisma } from "@/lib/prisma";
import { calculateBoardFeet, roundFeet } from "./calculator";
import { readExcelBase64 } from "@/modules/import-excel/excel-reader";

// Sin acentos que despojar: los alias de encabezado que se comparan acá
// (medida, piezas, cantidad, etc.) son todos ASCII simple — a diferencia
// de normalizeHeader en import-excel/import-service.ts, no hace falta
// pasar por NFD.
function normalizeCubicationHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * prompt-timber-cubicacion-carga.md, Parte B — "1 X 12 X16" / "2 x 4 x 11":
 * el aserradero manda mayúsculas y espaciado inconsistentes, tolerante a
 * cero o varios espacios alrededor de cada "x".
 */
const MEDIDA_PATTERN = /^\s*(\d+)\s*[xX]\s*(\d+)\s*[xX]\s*(\d+)\s*$/;

type TimberCubicationImportRecognizedLine = {
  thickness: number;
  width: number;
  length: number;
  pieces: number;
  /** Recalculado con calculateBoardFeet (la fórmula propia) — la columna PIES del archivo NUNCA se usa. */
  calculatedFeet: number;
  /** Piezas que ya tenía esta medida en el viaje, si existía — null si es una medida nueva. */
  existingPieces: number | null;
  action: "CREATE" | "UPDATE";
};

type TimberCubicationImportUnrecognizedRow = {
  rowNumber: number;
  rawMedida: string;
  rawPiezas: string;
  reason: string;
};

export type TimberCubicationImportPreview = {
  tripId: string;
  tripCode: string;
  recognized: TimberCubicationImportRecognizedLine[];
  unrecognized: TimberCubicationImportUnrecognizedRow[];
};

/**
 * prompt-timber-cubicacion-carga.md, Parte B — pura, exportada para
 * test: parsea la matriz cruda (ya leída por readExcelBase64) contra las
 * piezas que YA existen en el viaje (`existingByKey`, sin tocar DB acá).
 * Separada de previewTimberCubicationImport para poder probar la parte
 * que de verdad puede fallar (regex tolerante a mayúsculas/espacios,
 * fila TOTALES, medidas repetidas, columnas no encontradas) sin base de
 * datos.
 */
export function parseCubicationMatrix(
  matrix: string[][],
  existingByKey: Map<string, number>,
): Pick<TimberCubicationImportPreview, "recognized" | "unrecognized"> {
  if (matrix.length < 2) throw new Error("EMPTY_CUBICATION_FILE");

  const headers = matrix[0].map(normalizeCubicationHeader);
  const medidaIdx = headers.findIndex((h) => ["medida", "medidas", "dimension", "dimensiones", "corte"].includes(h));
  const piezasIdx = headers.findIndex((h) => ["piezas", "pieza", "cantidad", "cant", "qty", "unidades"].includes(h));
  if (medidaIdx === -1 || piezasIdx === -1) {
    throw new Error("CUBICATION_COLUMNS_NOT_FOUND");
  }

  // Varias filas del archivo pueden traer la MISMA medida (el aserradero
  // separa por tarima/atado) — se suman las piezas antes de comparar
  // contra lo existente, para que el preview refleje un solo CREATE/UPDATE
  // por medida, no uno por fila.
  const recognizedByKey = new Map<string, TimberCubicationImportRecognizedLine>();
  const unrecognized: TimberCubicationImportUnrecognizedRow[] = [];

  for (let rowIdx = 1; rowIdx < matrix.length; rowIdx += 1) {
    const row = matrix[rowIdx];
    const rawMedida = (row[medidaIdx] ?? "").trim();
    const rawPiezas = (row[piezasIdx] ?? "").trim();
    if (!rawMedida) continue; // fila en blanco — no es un dato, no es un error

    // Fila "TOTALES" (u otra fila de resumen) al final de la hoja: se
    // ignora en silencio, no es una medida no reconocida.
    if (/^totales?\b/i.test(rawMedida)) continue;

    const match = MEDIDA_PATTERN.exec(rawMedida);
    const pieces = Number(rawPiezas.replace(",", "."));
    if (!match) {
      unrecognized.push({ rowNumber: rowIdx + 1, rawMedida, rawPiezas, reason: "Formato de medida no reconocido (esperado ej. \"1 X 12 X 16\")" });
      continue;
    }
    if (!Number.isFinite(pieces) || pieces <= 0) {
      unrecognized.push({ rowNumber: rowIdx + 1, rawMedida, rawPiezas, reason: "Piezas vacío, cero o no numérico" });
      continue;
    }

    const thickness = Number(match[1]);
    const width = Number(match[2]);
    const length = Number(match[3]);
    const key = `${thickness}x${width}x${length}`;
    const existing = recognizedByKey.get(key);
    if (existing) {
      existing.pieces += pieces;
      existing.calculatedFeet = roundFeet(calculateBoardFeet({ thickness, width, length }) * existing.pieces);
      continue;
    }
    const existingPieces = existingByKey.get(key) ?? null;
    recognizedByKey.set(key, {
      thickness,
      width,
      length,
      pieces,
      calculatedFeet: roundFeet(calculateBoardFeet({ thickness, width, length }) * pieces),
      existingPieces,
      action: existingPieces !== null ? "UPDATE" : "CREATE",
    });
  }

  return { recognized: Array.from(recognizedByKey.values()), unrecognized };
}

/**
 * prompt-timber-cubicacion-carga.md, Parte B — vista previa de una carga
 * de cubicación completa desde el Excel que el usuario recuenta a mano
 * (hoja "Simple", columna MEDIDA + PIEZAS; columna PIES del archivo se
 * ignora siempre — se recalcula acá con calculateBoardFeet, la MISMA
 * fórmula que usa el resto del módulo, no una copia). No escribe nada:
 * el llamador aplica el resultado editando `lines` en el cliente (mismo
 * mecanismo que updateLinePieces/addMeasure en timber-workspace.tsx) y
 * lo guarda con el PUT de siempre — no hay un camino de escritura nuevo.
 */
export async function previewTimberCubicationImport(id: string, fileBase64: string): Promise<TimberCubicationImportPreview> {
  const trip = await prisma.timberTrip.findUnique({ where: { id }, include: { lines: true } });
  if (!trip) throw new Error("TIMBER_TRIP_NOT_FOUND");

  const matrix = await readExcelBase64(fileBase64, "Simple");
  const existingByKey = new Map(trip.lines.map((line) => [`${line.thicknessIn}x${line.widthIn}x${line.lengthIn}`, line.pieces]));
  const { recognized, unrecognized } = parseCubicationMatrix(matrix, existingByKey);

  return { tripId: trip.id, tripCode: trip.tripCode, recognized, unrecognized };
}
