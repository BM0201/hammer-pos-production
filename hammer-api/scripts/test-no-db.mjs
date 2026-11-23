// Preload de `npm test`: las pruebas NUNCA tocan la base real.
// Sin esto, el `prisma` global (p. ej. logAuditEvent) leía hammer-api/.env y
// escribía filas falsas en la AuditLog de producción en cada corrida (11,002
// filas entre 2026-09-19 y 2026-11-23, ya borradas). Prisma no pisa variables
// ya definidas, así que fijarlas acá gana sobre el .env. Una prueba que
// necesite datos usa un fake de `tx`; si llega a la base, falla en vez de escribir.
const NOWHERE = "postgresql://test:test@127.0.0.1:9/sin_base";
process.env.DATABASE_URL = NOWHERE;
process.env.DIRECT_URL = NOWHERE;
delete process.env.PRISMA_USE_NEON_ADAPTER;
