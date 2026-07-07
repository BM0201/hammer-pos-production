-- Add ACCOUNTANT to the RoleCode enum.
-- Nuevo perfil global "Contador": acceso exclusivo al módulo de Finanzas & Contabilidad.
-- Postgres exige que ADD VALUE viva en su propia migración (no puede usarse el
-- valor recién creado dentro de la misma transacción que lo agrega).
ALTER TYPE "RoleCode" ADD VALUE IF NOT EXISTS 'ACCOUNTANT';
