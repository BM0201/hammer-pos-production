import assert from "node:assert/strict";
import test from "node:test";
import { planTripCorrection, tripCorrectableUntil, tripCorrectionStockError, TRIP_CORRECTION_WINDOW_MS } from "@/modules/timber/service";

const confirmedAt = new Date("2026-11-23T16:00:00Z"); // 10:00 en Managua

test("ventana de corrección: 24 h exactas desde el ingreso", () => {
  const trip = { status: "TRANSFERRED", confirmedAt };
  assert.equal(tripCorrectableUntil(trip, new Date("2026-11-24T15:59:59Z"))?.toISOString(), "2026-11-24T16:00:00.000Z");
  assert.equal(tripCorrectableUntil(trip, new Date(confirmedAt.getTime() + TRIP_CORRECTION_WINDOW_MS)), null);
  assert.equal(tripCorrectableUntil(trip, new Date("2026-11-25T09:00:00Z")), null);
});

test("ventana de corrección: borradores y cancelados nunca", () => {
  const now = new Date("2026-11-23T17:00:00Z");
  assert.equal(tripCorrectableUntil({ status: "DRAFT", confirmedAt: null }, now), null);
  assert.equal(tripCorrectableUntil({ status: "CANCELLED", confirmedAt }, now), null);
  assert.equal(tripCorrectableUntil({ status: "TRANSFERRED", confirmedAt: null }, now), null);
});

test("revierte lo que el viaje metió y aplica lo nuevo, por diferencia", () => {
  const prior = [
    { productId: "tabla-1x12x6", pieces: 100, unitCost: 300 },
    { productId: "regla-1x3x5", pieces: 40, unitCost: 50 },
  ];
  const next = [
    { productId: "tabla-1x12x6", pieces: 90, unitCost: 310 }, // contaron 10 de más
    { productId: "cuarton-2x4x5", pieces: 20, unitCost: 120 }, // la regla era en realidad cuartón
  ];
  assert.deepEqual(planTripCorrection(prior, next), [
    { productId: "tabla-1x12x6", pieces: -10, unitCost: 310 },
    { productId: "regla-1x3x5", pieces: -40, unitCost: 50 },
    { productId: "cuarton-2x4x5", pieces: 20, unitCost: 120 },
  ]);
});

test("cuenta las correcciones anteriores: corregir de vuelta al original deja todo como al ingresar", () => {
  const ingreso = { productId: "tabla-1x12x6", pieces: 100, unitCost: 300 };
  const primeraCorreccion = { productId: "tabla-1x12x6", pieces: -10, unitCost: 300 };
  assert.deepEqual(planTripCorrection([ingreso, primeraCorreccion], [{ productId: "tabla-1x12x6", pieces: 100, unitCost: 300 }]), [
    { productId: "tabla-1x12x6", pieces: 10, unitCost: 300 },
  ]);
});

test("solo cambiar gastos (mismas piezas) no mueve inventario", () => {
  assert.deepEqual(planTripCorrection([{ productId: "tabla", pieces: 50, unitCost: 300 }], [{ productId: "tabla", pieces: 50, unitCost: 280 }]), []);
});

test("si ya se vendió, el mensaje dice la medida y cuántas quedan", () => {
  const error = tripCorrectionStockError("TABLA 1X12X6", 30, 12);
  assert.equal((error as Error & { code: string }).code, "TRIP_CORRECTION_STOCK_SOLD");
  assert.match(error.message, /quitar 30 piezas de TABLA 1X12X6: solo quedan 12 piezas/);
  assert.match(error.message, /al menos 18 piezas más/);
});
