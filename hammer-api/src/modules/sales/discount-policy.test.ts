import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { computeDiscountAgainstCatalogPrice, validateDiscountForRole } from "@/modules/sales/discount-policy";

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

/**
 * Auditoría 2026-07-22 (ALTO Órdenes): sales/service.ts calculaba
 * discountPercent contra unitPrice (que el caller puede fijar manualmente
 * en vez de usar discountAmount) — un cajero podía pasar unitPrice=70 en un
 * producto de catálogo C$100, con discountAmount=0, y el sistema veía
 * discountPercent=0% (nada que validar), evadiendo por completo el límite
 * de descuento por rol (5% para cajero) y el bloqueo de riesgo CZ.
 */
test("C-Ordenes (bug documentado): unitPrice manual bajo el precio real da 0% de descuento aparente", () => {
  // Catálogo: C$100. Cajero pasa unitPrice=70 directo, discountAmount=0.
  // Antes del fix: discountPercent = discountAmount/unitPrice = 0/70 = 0%.
  const buggyDiscountPercent = decimal(0).div(decimal(70)).mul(100);
  assert.equal(buggyDiscountPercent.toString(), "0");
});

test("C-Ordenes (fix): el mismo caso ahora mide el 30% real de descuento contra el precio de catalogo", () => {
  const result = computeDiscountAgainstCatalogPrice({
    catalogPrice: decimal(100),
    unitPrice: decimal(70),
    discountAmount: decimal(0),
    quantity: decimal(1),
  });

  assert.equal(result.netUnitPriceAfterDiscount.toString(), "70");
  assert.equal(result.discountPercent.toString(), "30");
});

test("C-Ordenes (fix): ese 30% ahora es bloqueado para un cajero (limite 5%)", () => {
  const result = computeDiscountAgainstCatalogPrice({
    catalogPrice: decimal(100),
    unitPrice: decimal(70),
    discountAmount: decimal(0),
    quantity: decimal(1),
  });

  const policy = validateDiscountForRole({
    role: "CAJA",
    discountPercent: result.discountPercent,
    effectiveCost: decimal(50),
    netUnitPriceAfterDiscount: result.netUnitPriceAfterDiscount,
  });

  assert.equal(policy.allowed, false);
  assert.equal(policy.code, "DISCOUNT_LIMIT_EXCEEDED");
});

test("C-Ordenes: sin manipular unitPrice, el calculo no cambia (unitPrice === catalogPrice)", () => {
  // Venta normal con 10% de descuento explicito via discountAmount.
  const result = computeDiscountAgainstCatalogPrice({
    catalogPrice: decimal(100),
    unitPrice: decimal(100),
    discountAmount: decimal(10),
    quantity: decimal(1),
  });

  assert.equal(result.netUnitPriceAfterDiscount.toString(), "90");
  assert.equal(result.discountPercent.toString(), "10");
});

test("C-Ordenes: un unitPrice manual POR ENCIMA del catalogo (markup) no genera un descuento negativo bloqueante", () => {
  const result = computeDiscountAgainstCatalogPrice({
    catalogPrice: decimal(100),
    unitPrice: decimal(120),
    discountAmount: decimal(0),
    quantity: decimal(1),
  });

  assert.equal(result.discountPercent.lte(0), true, "un markup no debe verse como descuento positivo");
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
