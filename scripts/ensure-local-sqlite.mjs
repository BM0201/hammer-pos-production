#!/usr/bin/env node

console.warn("[local:prepare-sqlite] Este proyecto usa PostgreSQL (no SQLite).\n" +
  "Se mantiene este script por compatibilidad para evitar fallos de npm scripts.");
console.warn("[local:prepare-sqlite] Acción recomendada: configura DATABASE_URL a un PostgreSQL local o gestionado.");
process.exit(0);
