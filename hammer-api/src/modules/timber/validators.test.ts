import assert from "node:assert/strict";
import test from "node:test";
import { createTimberTripSchema, updateTimberTripSchema } from "@/modules/timber/validators";

/**
 * prompt-timber-borrador-bugs.md, BUG 2 — el autoguardado de un DRAFT
 * (timber-workspace.tsx save()) SIEMPRE manda `lines`, incluso vacío,
 * mientras el usuario edita (por ejemplo, quitó todas las líneas antes
 * de volver a agregar) — un 400 en ese momento es el bug real. La
 * exigencia de "al menos 1 línea" sigue viva donde corresponde: al
 * CREAR un viaje (createTimberTripSchema, sin cambios) y al CONFIRMARLO
 * de verdad (confirmTimberTrip → TRIP_HAS_NO_LINES, sin tocar en este
 * ciclo).
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

test("createTimberTripSchema SIGUE exigiendo al menos 1 línea al crear un viaje nuevo — este límite no se tocó", () => {
  const result = createTimberTripSchema.safeParse({
    destinationBranchId: "branch-1",
    lines: [],
  });
  assert.equal(result.success, false, "crear un viaje sin ninguna línea debe seguir rechazado");
});

test("createTimberTripSchema acepta crear con al menos 1 línea", () => {
  const result = createTimberTripSchema.safeParse({
    destinationBranchId: "branch-1",
    lines: [VALID_LINE],
  });
  assert.equal(result.success, true);
});
