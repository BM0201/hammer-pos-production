#!/usr/bin/env node
// =============================================================================
// ensure-local-dev-env.mjs
// Validates / bootstraps the local .env for development with PostgreSQL.
// SQLite is NO LONGER supported. DATABASE_URL must be a valid PostgreSQL URL.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const root = process.cwd();
const envPath = path.join(root, ".env");
const envExamplePath = path.join(root, ".env.example");
const envLocalExamplePath = path.join(root, ".env.local.example");

// ---------------------------------------------------------------------------
// PostgreSQL URL pattern: postgresql:// or postgres://
// ---------------------------------------------------------------------------
const PG_URL_RE = /^postgres(ql)?:\/\/.+/i;
const DEFAULT_LOCAL_PG_URL =
  "postgresql://hammer:hammer@localhost:5432/hammer_pos_dev";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseEnv(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .reduce((acc, line) => {
      const separatorIndex = line.indexOf("=");
      const key = line.slice(0, separatorIndex).trim();
      const value = line
        .slice(separatorIndex + 1)
        .trim()
        .replace(/^"|"$/g, "");
      acc[key] = value;
      return acc;
    }, {});
}

function upsertEnvValue(fileContents, key, value) {
  const lines = fileContents.split(/\r?\n/);
  const nextValue = `"${value}"`;
  let updated = false;
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("="))
      return line;
    const separatorIndex = line.indexOf("=");
    const currentKey = line.slice(0, separatorIndex).trim();
    if (currentKey !== key) return line;
    updated = true;
    return `${key}=${nextValue}`;
  });

  if (!updated) nextLines.push(`${key}=${nextValue}`);
  return `${nextLines.join("\n").replace(/\n+$/g, "")}\n`;
}

function isPlaceholderSecret(secret) {
  if (!secret) return true;
  const normalized = secret.toLowerCase();
  return (
    normalized.includes(
      "replace_with_a_very_long_random_secret_value_min_32_chars"
    ) ||
    normalized.includes("replace_with_random_secret_min_32_chars") ||
    normalized.includes("change_me") ||
    normalized.includes("changeme")
  );
}

function isSqliteUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.startsWith("file:") || lower.includes("sqlite");
}

function isValidPostgresUrl(url) {
  return PG_URL_RE.test(url || "");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// 1. Ensure .env exists — copy from .env.local.example (preferred) or .env.example
if (!fs.existsSync(envPath)) {
  const source = fs.existsSync(envLocalExamplePath)
    ? envLocalExamplePath
    : envExamplePath;
  fs.copyFileSync(source, envPath);
  console.log(
    `[local:prepare-env] .env no existía. Se creó desde ${path.basename(source)}`
  );
}

let envRaw = fs.readFileSync(envPath, "utf8");
let env = parseEnv(envRaw);

// 2. Validate DATABASE_URL — reject SQLite, require PostgreSQL
if (isSqliteUrl(env.DATABASE_URL)) {
  console.error(
    "\n╔══════════════════════════════════════════════════════════════╗"
  );
  console.error(
    "║  ❌  SQLite ya NO es soportado en H.A.M.M.E.R. POS         ║"
  );
  console.error(
    "║  Tu DATABASE_URL apunta a SQLite (file:./dev.db o similar). ║"
  );
  console.error(
    "║  Debes usar PostgreSQL para desarrollo local.               ║"
  );
  console.error(
    "╚══════════════════════════════════════════════════════════════╝\n"
  );
  console.error("  Se reemplazará tu DATABASE_URL con una URL PostgreSQL local.");
  console.error(`  Nueva URL: ${DEFAULT_LOCAL_PG_URL}\n`);
  envRaw = upsertEnvValue(envRaw, "DATABASE_URL", DEFAULT_LOCAL_PG_URL);
  env = parseEnv(envRaw);
  console.log(
    `[local:prepare-env] DATABASE_URL actualizada a PostgreSQL: ${DEFAULT_LOCAL_PG_URL}`
  );
}

if (!isValidPostgresUrl(env.DATABASE_URL)) {
  // DATABASE_URL is missing or not a valid postgres URL — set default
  envRaw = upsertEnvValue(envRaw, "DATABASE_URL", DEFAULT_LOCAL_PG_URL);
  env = parseEnv(envRaw);
  console.log(
    `[local:prepare-env] DATABASE_URL ausente o inválida. Se configuró: ${DEFAULT_LOCAL_PG_URL}`
  );
}

// 3. Ensure AUTH_SESSION_SECRET is strong
if (
  !env.AUTH_SESSION_SECRET ||
  env.AUTH_SESSION_SECRET.length < 32 ||
  isPlaceholderSecret(env.AUTH_SESSION_SECRET)
) {
  const generatedSecret = randomBytes(32).toString("hex");
  envRaw = upsertEnvValue(envRaw, "AUTH_SESSION_SECRET", generatedSecret);
  console.log(
    "[local:prepare-env] AUTH_SESSION_SECRET insegura/ausente detectada. Se generó una nueva clave local segura."
  );
}

// 4. Write final .env
fs.writeFileSync(envPath, envRaw, "utf8");

// 5. Final validation — re-read and verify
const finalEnv = parseEnv(fs.readFileSync(envPath, "utf8"));
if (!isValidPostgresUrl(finalEnv.DATABASE_URL)) {
  console.error(
    "\n❌ ERROR FATAL: DATABASE_URL no es una URL PostgreSQL válida."
  );
  console.error(`   Valor actual: ${finalEnv.DATABASE_URL}`);
  console.error(
    "\n   Para desarrollo local necesitas PostgreSQL corriendo."
  );
  console.error("   Opciones:");
  console.error(
    "     1. Docker:  docker run -d --name hammer-pg -e POSTGRES_USER=hammer -e POSTGRES_PASSWORD=hammer -e POSTGRES_DB=hammer_pos_dev -p 5432:5432 postgres:16-alpine"
  );
  console.error(
    `     2. Editar .env:  DATABASE_URL="${DEFAULT_LOCAL_PG_URL}"\n`
  );
  process.exit(1);
}

if (isSqliteUrl(finalEnv.DATABASE_URL)) {
  console.error("\n❌ ERROR FATAL: SQLite no es soportado. DATABASE_URL no puede apuntar a un archivo SQLite.");
  process.exit(1);
}

console.log("[local:prepare-env] ✅ OK — PostgreSQL configurado correctamente.");
console.log(`[local:prepare-env] DATABASE_URL = ${finalEnv.DATABASE_URL.replace(/\/\/.*@/, "//***@")}`);
