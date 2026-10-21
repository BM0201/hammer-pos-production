-- prompt-entrada-reintento-precio.md Commit 1 §3 — errorJson guarda la
-- lista COMPLETA de problemas de una sucursal fallida, en español, con el
-- producto (antes: solo `error`, un texto en inglés con el primer error
-- nada más). Aditiva: columna nueva nullable, no toca ninguna fila
-- existente — las filas viejas siguen leyendo `error` como siempre.

-- AlterTable
ALTER TABLE "MultiBranchIntakeBranch" ADD COLUMN "errorJson" JSONB;
