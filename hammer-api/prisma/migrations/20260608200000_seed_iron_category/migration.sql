-- [V2] Iron module — physical "Hierro" category
-- Creates the canonical "Hierro" category used to group iron products
-- sold as quintal (HIERRO 3/8, 1/2, 1/4) and varilla (VARILLA HIERRO ...).
-- Idempotent: safe to re-run; relies on the unique "code" constraint.

INSERT INTO "Category" ("id", "code", "name", "parentId", "isActive", "createdAt", "updatedAt")
VALUES ('cat_hierro_v2', 'HIERRO', 'Hierro', NULL, true, NOW(), NOW())
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name",
      "isActive" = true,
      "updatedAt" = NOW();
