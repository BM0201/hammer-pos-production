import assert from "node:assert/strict";
import test from "node:test";
import { createTimberTripSchema, updateTimberTripSchema } from "@/modules/timber/validators";

/**
 * prompt-timber-borrador-bugs.md, BUG 2 — el autoguardado de un DRAFT
 * (timber-workspace.tsx save()) SIEMPRE manda `lines`, incluso vacío,
 * mientras el usuario edita (por ejemplo, quitó todas las líneas antes
 * de volver a agregar) — un 400 en ese momento es el bug real. La
 * exigencia de "al menos 1 línea" vive al CONFIRMARLO de verdad
 * (confirmTimberTrip → TRIP_HAS_NO_LINES): crear también acepta vacío.
 */

const VALID_LINE = { thickness: 1, width: 12, length: 16, pieces: 10 };

test("Test LA QUE IMPORTA — updateTimberTripSchema acepta lines: [] (un DRAFT a medio editar, sin líneas todavía)", () => {
  const result = updateTimberTripSchema.safeParse({ lines: [] });
  assert.equal(result.success, true, result.success ? "" : JSON.stringify(result.error.issues));
});

test("updateTimberTripSchema sigue aceptando lines con contenido real", () => {
  const result = updateTimberTripSchema.safeParse({ lines: [VALID_LINE] });
  assert.equal(result.success, true);
});

test("updateTimberTripSchema sigue aceptando el campo lines omitido por completo (PATCH parcial de otros campos)", () => {
  const result = updateTimberTripSchema.safeParse({ notes: "sin cambiar líneas" });
  assert.equal(result.success, true);
});

test("createTimberTripSchema acepta un viaje sin líneas — antes la pantalla mandaba una medida de relleno que había que borrar", () => {
  const result = createTimberTripSchema.safeParse({ destinationBranchId: "branch-1", lines: [] });
  assert.equal(result.success, true);
});

test("createTimberTripSchema acepta crear con al menos 1 línea", () => {
  const result = createTimberTripSchema.safeParse({
    destinationBranchId: "branch-1",
    lines: [VALID_LINE],
  });
  assert.equal(result.success, true);
});
