-- Índice compuesto para acelerar la búsqueda del borrador activo por
-- sucursal + usuario + estado (consulta que corre en cada carga del POS).
CREATE INDEX "SaleOrder_branchId_createdByUserId_status_idx"
  ON "SaleOrder" ("branchId", "createdByUserId", "status");
