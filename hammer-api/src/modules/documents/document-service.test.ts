import assert from "node:assert/strict";
import test from "node:test";
import { deliveryOrderPrefix } from "@/modules/documents/document-service";

test("orden de entrega: la fecha del número es la de Managua, no la UTC", () => {
  // 18 nov 01:30 UTC = 17 nov 19:30 en Managua
  assert.equal(deliveryOrderPrefix("MGA", new Date("2026-11-18T01:30:00Z")), "OE-MGA-20261117-");
  assert.equal(deliveryOrderPrefix("MGA", new Date("2026-11-18T06:30:00Z")), "OE-MGA-20261118-");
});
