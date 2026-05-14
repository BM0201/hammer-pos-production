#!/usr/bin/env node
// =============================================================================
// ensure-local-sqlite.mjs — DEPRECATED / REMOVED
// SQLite ya NO es soportado en H.A.M.M.E.R. POS.
// Este script existe únicamente para emitir un error claro si alguien lo ejecuta.
// =============================================================================

console.error(
  "\n╔══════════════════════════════════════════════════════════════════╗"
);
console.error(
  "║  ❌  SQLite ya NO es soportado en H.A.M.M.E.R. POS             ║"
);
console.error(
  "║                                                                  ║"
);
console.error(
  "║  Este script (ensure-local-sqlite.mjs) ha sido deshabilitado.   ║"
);
console.error(
  "║  El proyecto ahora requiere PostgreSQL para todos los entornos. ║"
);
console.error(
  "║                                                                  ║"
);
console.error(
  "║  Para configurar PostgreSQL local:                              ║"
);
console.error(
  '║  1. Instala PostgreSQL o usa Docker:                            ║'
);
console.error(
  "║     docker run -d --name hammer-pg \\                            ║"
);
console.error(
  "║       -e POSTGRES_USER=hammer \\                                 ║"
);
console.error(
  "║       -e POSTGRES_PASSWORD=hammer \\                             ║"
);
console.error(
  "║       -e POSTGRES_DB=hammer_pos_dev \\                           ║"
);
console.error(
  "║       -p 5432:5432 postgres:16-alpine                          ║"
);
console.error(
  "║                                                                  ║"
);
console.error(
  "║  2. Configura DATABASE_URL en .env:                             ║"
);
console.error(
  '║     DATABASE_URL="postgresql://hammer:hammer@localhost:5432/    ║'
);
console.error(
  '║                   hammer_pos_dev"                               ║'
);
console.error(
  "║                                                                  ║"
);
console.error(
  "║  3. Ejecuta: npm run local:prepare-env                         ║"
);
console.error(
  "╚══════════════════════════════════════════════════════════════════╝\n"
);

process.exit(1);
