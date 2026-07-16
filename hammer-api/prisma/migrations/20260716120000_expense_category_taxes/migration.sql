-- Categoría de gasto TAXES: impuestos del negocio (Alcaldía y DGI).
-- Son gastos importantes y recurrentes que antes caían en OTHER — con
-- categoría propia el historial y el presupuesto inteligente los siguen bien.

-- AlterEnum
ALTER TYPE "ExpenseCategory" ADD VALUE IF NOT EXISTS 'TAXES';
