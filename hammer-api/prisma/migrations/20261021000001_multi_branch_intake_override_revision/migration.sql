-- prompt-entrada-reintento-precio.md Commit 2 §2/§3 — "editar y
-- reintentar": linesOverrideJson guarda SOLO las líneas pendientes
-- corregidas de una sucursal FAILED (null = usa las líneas del pedido
-- general, como siempre); revision es concurrencia optimista para el PUT
-- de edición (expectedRevision debe coincidir o 409). Aditiva: columnas
-- nuevas nullable/con default, no toca ninguna fila existente.

-- AlterTable
ALTER TABLE "MultiBranchIntakeBranch" ADD COLUMN "linesOverrideJson" JSONB;
ALTER TABLE "MultiBranchIntakeBranch" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
