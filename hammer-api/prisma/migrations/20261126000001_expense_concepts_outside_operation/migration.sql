-- Conceptos semilla de las categorías nuevas y de los que más se escribían
-- a mano en "Otro" (pasaje al banco, bridas para exhibir, reparaciones).
-- Idempotente: ON CONFLICT por (category, name).
INSERT INTO "ExpenseConcept" ("id", "category", "name", "sortOrder", "updatedAt") VALUES
  (concat('xpc_', gen_random_uuid()::text), 'EQUIPMENT',      'Herramienta o equipo',   0, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'EQUIPMENT',      'Mejora del local',       1, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'OWNER_PERSONAL', 'Gasto personal',         0, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'OWNER_PERSONAL', 'Mandado personal',       1, CURRENT_TIMESTAMP),
  (concat('xpc_', gen_random_uuid()::text), 'SUPPLIES',       'Exhibición (bridas, ganchos)', 3, CURRENT_TIMESTAMP)
ON CONFLICT ("category", "name") DO NOTHING;
