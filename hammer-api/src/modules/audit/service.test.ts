import assert from "node:assert/strict";
import test from "node:test";
import { attachAuditToError, writePendingAuditFromError } from "@/modules/audit/service";

/**
 * prompt-auditoria-rechazos-y-cierre-de-costos.md A-0 — tx.auditLog.create()
 * dentro de un prisma.$transaction seguido de throw en el mismo camino se
 * revertía junto con todo lo demás (SALE_ORDER_LINE_MUTATION_DENIED tenía
 * cero filas en producción pese a 24k+ eventos de auditoría reales). El
 * mecanismo de arreglo: adjuntar el payload al error dentro de la
 * transacción, escribirlo con logAuditEvent FUERA de ella, en el catch de la
 * función pública. logAuditEvent en sí toca la base real — solo se prueba
 * acá la parte pura: que el payload viaja en el error, y que sin payload no
 * se intenta escribir nada (la rama que sí puede probarse sin DB).
 */

test("attachAuditToError: adjunta el payload al MISMO objeto error, no crea uno nuevo", () => {
  const error = new Error("BELOW_COST_NOT_ALLOWED");
  const payload = {
    actorUserId: "user-1",
    branchId: "branch-1",
    module: "sales",
    action: "SALE_ORDER_LINE_MUTATION_DENIED",
    entityType: "SaleOrder",
    entityId: "order-1",
    metadataJson: { reason: "BELOW_COST_NOT_ALLOWED", effectiveCost: "100", netUnitPriceAfterDiscount: "90", costSource: "WAC_ESTIMATE", priceSource: "BRANCH" },
  };
  const returned = attachAuditToError(error, payload);

  assert.equal(returned, error, "debe devolver la MISMA instancia, no una copia");
  assert.deepEqual((error as unknown as { auditPayload: unknown }).auditPayload, payload);
  assert.equal(error.message, "BELOW_COST_NOT_ALLOWED", "el mensaje original del error no se toca");
});

test("attachAuditToError: preserva propiedades ya puestas en el error (ej. .details, .checklist)", () => {
  const error = new Error("BELOW_COST_OVERRIDE_REASON_REQUIRED") as Error & { details?: unknown };
  error.details = { effectiveCost: 100, netUnitPriceAfterDiscount: 90 };
  attachAuditToError(error, {
    module: "sales",
    action: "SALE_ORDER_LINE_MUTATION_DENIED",
    entityType: "SaleOrder",
    entityId: "order-1",
  });

  assert.deepEqual(error.details, { effectiveCost: 100, netUnitPriceAfterDiscount: 90 });
  assert.ok((error as unknown as { auditPayload: unknown }).auditPayload);
});

test("writePendingAuditFromError: sin auditPayload, no hace nada (no revienta, no intenta tocar la base)", async () => {
  await assert.doesNotReject(() => writePendingAuditFromError(new Error("ORDER_NOT_DRAFT")));
  await assert.doesNotReject(() => writePendingAuditFromError(null));
  await assert.doesNotReject(() => writePendingAuditFromError(undefined));
  await assert.doesNotReject(() => writePendingAuditFromError("no es ni siquiera un Error"));
});
