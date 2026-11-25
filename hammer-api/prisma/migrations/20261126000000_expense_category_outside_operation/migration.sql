-- Gastos fuera de la operación (2026-11-26): equipo/mejoras del local
-- (inversión, no gasto del mes) y gastos personales del dueño (retiro, no
-- costo de la ferretería). Salió dinero de caja igual, pero NO restan de la
-- utilidad operativa ni entran al % de gasto de Precios.
-- 100% aditivo: solo agrega valores al enum. Los conceptos que los usan van
-- en la migración siguiente (Postgres no deja usar un valor nuevo del enum
-- en la misma transacción que lo agrega).

ALTER TYPE "ExpenseCategory" ADD VALUE 'EQUIPMENT';
ALTER TYPE "ExpenseCategory" ADD VALUE 'OWNER_PERSONAL';
