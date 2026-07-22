import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { validateDiscountForRole } from "@/modules/sales/discount-policy";

function decimal(value: number) {
  return new Prisma.Decimal(value);
}

/**
 * Auditoría 2026-07-22, hallazgo C8: el motor de sugerencias ABC-XYZ recomienda
 * 15% de descuento para clase CZ (getBasePercentageFromAbcXyz en
 * discounts/service.ts). Un Master crea una campaña activa con ese 15% en un
 * producto CZ (createDiscount exige assertMaster). Cuando un cajero (rol con
 * límite 5%, sin autoridad de override de riesgo comercial) vende ese
 * producto, el auto-apply de la campaña generaba discountPercent=15% y
 * validateDiscountForRole lo bloqueaba con DISCOUNT_LIMIT_EXCEEDED —
 * el producto quedaba invendible en caja mientras la campaña seguía activa.
 *
 * Decisión de negocio (usuario, 2026-07-22): el creador de la campaña manda.
 * Fix: cuando el descuento viene de una campaña activa (no de que el cajero
 * lo haya tecleado), sales/service.ts pasa role="MASTER" (la autoridad real
 * de createDiscount, que exige assertMaster) en vez del rol del cajero que
 * vende, y la ruta sintetiza un overrideReason ("Descuento aplicado por
 * campaña activa...") ya que el Master justificó el descuento al crear la
 * campaña, no tecleando una razón en caja.
 */
test("C8 (bug documentado): sin el fix, un cajero con 15% de campaña CZ queda bloqueado", () => {
  const result = validateDiscountForRole({
    role: "CAJA",
    discountPercent: decimal(15),
    effectiveCost: decimal(50),
    netUnitPriceAfterDiscount: decimal(85),
    combinedClass: "CZ",
    riskLevel: "CRITICAL",
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, "DISCOUNT_LIMIT_EXCEEDED");
});

test("C8 (bug documentado): MASTER solo no basta — sin razon de override, CZ sigue bloqueado", () => {
  // Resolver el rol a MASTER no es suficiente por si solo: la politica exige
  // ademas una razon de override para CUALQUIER descuento >0 en CZ, incluso
  // para MASTER. Por eso la ruta tambien debe sintetizar overrideReason.
  const result = validateDiscountForRole({
    role: "MASTER",
    discountPercent: decimal(15),
    effectiveCost: decimal(50),
    netUnitPriceAfterDiscount: decimal(85),
    combinedClass: "CZ",
    riskLevel: "CRITICAL",
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, "DISCOUNT_LIMIT_EXCEEDED");
});

test("C8 (fix): la misma venta, resuelta con la autoridad de la campaña (MASTER) + razon sintetizada, queda permitida", () => {
  const result = validateDiscountForRole({
    role: "MASTER",
    discountPercent: decimal(15),
    effectiveCost: decimal(50),
    netUnitPriceAfterDiscount: decimal(85),
    overrideReason: "Descuento aplicado por campaña activa (creada por Master).",
    combinedClass: "CZ",
    riskLevel: "CRITICAL",
  });

  assert.equal(result.allowed, true);
});

test("C8 (fix): una campaña tan agresiva que vende bajo costo tambien queda permitida — igual que si un Master la tecleara a mano", () => {
  // Esto refleja exactamente la autoridad que un Master ya tiene manualmente
  // (canOverrideBelowCost=true + una razon) — el fix de C8 solo hace que esa
  // misma autoridad fluya desde la campaña en vez de requerir que el Master
  // este presente en caja tecleandola.
  const result = validateDiscountForRole({
    role: "MASTER",
    discountPercent: decimal(15),
    effectiveCost: decimal(90),
    netUnitPriceAfterDiscount: decimal(85), // < effectiveCost
    overrideReason: "Descuento aplicado por campaña activa (creada por Master).",
    combinedClass: "CZ",
    riskLevel: "CRITICAL",
  });

  assert.equal(result.allowed, true);
});

test("una venta manual (sin campaña) de un cajero sigue bloqueada igual que antes en CZ", () => {
  const result = validateDiscountForRole({
    role: "VENDEDOR",
    discountPercent: decimal(5),
    effectiveCost: decimal(50),
    netUnitPriceAfterDiscount: decimal(95),
    combinedClass: "CZ",
    riskLevel: "HIGH",
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, "DISCOUNT_LIMIT_EXCEEDED");
});
