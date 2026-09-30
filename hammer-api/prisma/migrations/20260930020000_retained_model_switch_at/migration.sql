-- prompt-tesoreria-sin-transito.md v2 Commit 1 — congela el corte de
-- getLastDepositCutoff en el instante en que este modelo entra en marcha.
-- ON CONFLICT DO NOTHING: si ya existe (redeploy, migración corrida dos
-- veces), no se pisa el valor original con un NOW() más tardío.
INSERT INTO "SystemSetting" ("id", "key", "value", "updatedAt", "createdAt")
VALUES (
  concat('sysset_', gen_random_uuid()::text),
  'treasury.retainedModelSwitchAt',
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  now(),
  now()
)
ON CONFLICT ("key") DO NOTHING;
