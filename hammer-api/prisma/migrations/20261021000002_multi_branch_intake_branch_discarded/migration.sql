-- prompt-entrada-reintento-precio.md Commit 2 §3 — "Descartar {sucursal}":
-- FAILED con processedLines=0 que el dueño decide no corregir pasa a
-- DISCARDED en vez de quedar como falla eterna. Migración SEPARADA de la
-- de linesOverrideJson/revision (regla del proyecto: un valor nuevo de
-- enum va solo, nunca junto con otro cambio de esquema).

-- AlterEnum
ALTER TYPE "MultiBranchIntakeBranchStatus" ADD VALUE 'DISCARDED';
