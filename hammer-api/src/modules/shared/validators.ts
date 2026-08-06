import { z } from "zod";

const MAX_MONEY = 1_000_000_000;
const MAX_QUANTITY = 1_000_000;
const MAX_INT = 10_000_000;

function hasMaxTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.trunc(value * 100)) < 1e-8;
}

const finiteNumberSchema = z.coerce
  .number()
  .refine((value) => Number.isFinite(value), "Debe ser un número finito.");

export const moneySchema = finiteNumberSchema
  .refine((value) => hasMaxTwoDecimals(value), "Debe tener máximo 2 decimales.")
  .refine((value) => Math.abs(value) <= MAX_MONEY, "Monto fuera de rango permitido.");

export const nonNegativeMoneySchema = moneySchema.refine(
  (value) => value >= 0,
  "El monto no puede ser negativo.",
);

export const positiveMoneySchema = moneySchema.refine(
  (value) => value > 0,
  "El monto debe ser mayor que cero.",
);

export const quantitySchema = finiteNumberSchema
  .refine((value) => value > 0, "La cantidad debe ser mayor que cero.")
  .refine((value) => value <= MAX_QUANTITY, "Cantidad fuera de rango permitido.")
  .refine((value) => hasMaxTwoDecimals(value), "La cantidad debe tener máximo 2 decimales.");

export const percentageSchema = finiteNumberSchema
  .refine((value) => value >= 0 && value <= 100, "El porcentaje debe estar entre 0 y 100.")
  .refine((value) => hasMaxTwoDecimals(value), "El porcentaje debe tener máximo 2 decimales.");

export const positiveIntSchema = z.coerce
  .number()
  .int("Debe ser un entero.")
  .refine((value) => value > 0, "Debe ser mayor que cero.")
  .refine((value) => value <= MAX_INT, "Entero fuera de rango permitido.");
