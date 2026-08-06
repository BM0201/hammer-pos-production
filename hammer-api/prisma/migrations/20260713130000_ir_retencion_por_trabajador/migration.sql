-- Retención de IR salarial POR TRABAJADOR (Ley 822).
-- La retención varía entre trabajadores: quienes tributan por su cuenta no la
-- llevan. Default false (no se retiene); se activa en la ficha del empleado
-- cuando a esa persona sí corresponde retenerle.

-- AlterTable
ALTER TABLE "Employee"
  ADD COLUMN "applyIrRetention" BOOLEAN NOT NULL DEFAULT false;
