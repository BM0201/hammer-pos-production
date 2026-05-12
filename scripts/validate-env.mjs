#!/usr/bin/env node
// =============================================================================
// validate-env.mjs — Validación de variables de entorno para H.A.M.M.E.R. POS
// =============================================================================
// Uso:
//   node scripts/validate-env.mjs                  # modo según NODE_ENV
//   node scripts/validate-env.mjs --mode=strict    # forzar modo estricto
//   node scripts/validate-env.mjs --mode=warn      # solo advertencias (dev)
//
// En producción SIEMPRE se ejecuta en modo estricto (exit 1 si hay errores).
// =============================================================================

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------
const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env");
const envProdPath = path.join(rootDir, ".env.production");
const examplePath = path.join(rootDir, ".env.production.example");
const lifecycle = process.env.npm_lifecycle_event ?? "unknown";

const VALID_NODE_ENVS = new Set(["development", "test", "production"]);
const VALID_APP_ENVS = new Set(["local", "demo", "staging", "production", "test"]);

// Patrones que indican un placeholder o valor inseguro en AUTH_SESSION_SECRET
const PLACEHOLDER_SECRET_PATTERNS = [
  "change_me",
  "changeme",
  "replace_with",
  "replace_me",
  "your-secret",
  "your_secret",
  "yoursecret",
  "example",
  "sample",
  "placeholder",
  "todo",
  "fixme",
  "xxxxxx",
  "000000",
  "aaaaaa",
];

// Valores exactos que son inseguros como secreto
const INSECURE_EXACT_SECRETS = new Set([
  "secret",
  "password",
  "development",
  "production",
  "default",
  "test",
  "demo",
  "admin",
  "hammer",
  "12345678901234567890123456789012",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .reduce((acc, line) => {
      const idx = line.indexOf("=");
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
      acc[key] = value;
      return acc;
    }, {});
}

function normalizeNodeEnv(rawValue) {
  const normalized = (rawValue ?? "development").trim().toLowerCase();
  return VALID_NODE_ENVS.has(normalized) ? normalized : "development";
}

function looksLikePlaceholderSecret(secret) {
  if (!secret || !secret.trim()) return true;
  const lower = secret.trim().toLowerCase();

  // Exact insecure values
  if (INSECURE_EXACT_SECRETS.has(lower)) return true;

  // Pattern-based detection
  if (PLACEHOLDER_SECRET_PATTERNS.some((p) => lower.includes(p))) return true;

  // All same character (e.g., "aaaa...a")
  if (new Set(lower).size <= 2 && lower.length >= 8) return true;

  return false;
}

function isValidPostgresUrl(urlValue) {
  if (!urlValue) return false;
  try {
    const protocol = new URL(urlValue).protocol;
    return protocol === "postgresql:" || protocol === "postgres:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Detectar entorno y modo de validación
// ---------------------------------------------------------------------------
// Intentar leer .env.production primero (para prestart en prod), luego .env
const prodFileEnv = parseDotEnvFile(envProdPath);
const devFileEnv = parseDotEnvFile(envPath);
const fileEnv = { ...devFileEnv, ...prodFileEnv };
const hasAnyEnvFile = fs.existsSync(envPath) || fs.existsSync(envProdPath);

const read = (key, fallback) => process.env[key] ?? fileEnv[key] ?? fallback;

const cliMode = process.argv
  .find((arg) => arg.startsWith("--mode="))
  ?.split("=")[1]
  ?.toLowerCase();
const rawNodeEnv = read("NODE_ENV", "development");
const nodeEnv = normalizeNodeEnv(rawNodeEnv);
const isProduction = nodeEnv === "production";
// En producción: siempre estricto. En dev: respeta --mode o default warn.
const validationMode = isProduction
  ? "strict"
  : cliMode ?? process.env.ENV_VALIDATION_MODE?.toLowerCase() ?? "warn";

// ---------------------------------------------------------------------------
// Leer variables
// ---------------------------------------------------------------------------
const env = {
  NODE_ENV: rawNodeEnv,
  APP_ENV: read("APP_ENV", ""),
  DATABASE_URL: read("DATABASE_URL", ""),
  AUTH_SESSION_SECRET: read("AUTH_SESSION_SECRET", ""),
  AUTH_SESSION_TTL_HOURS: read("AUTH_SESSION_TTL_HOURS", "12"),
  RUN_MIGRATIONS: read("RUN_MIGRATIONS", ""),
};

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------
const errors = [];
const warnings = [];

// --- NODE_ENV ---
if (!VALID_NODE_ENVS.has((env.NODE_ENV ?? "").trim().toLowerCase())) {
  errors.push({
    key: "NODE_ENV",
    message: `Debe ser development, test o production (actual: "${env.NODE_ENV}")`,
  });
}

// --- APP_ENV ---
if (isProduction) {
  if (env.APP_ENV !== "production") {
    errors.push({
      key: "APP_ENV",
      message: `Debe ser "production" cuando NODE_ENV=production (actual: "${env.APP_ENV}")`,
    });
  }
} else if (env.APP_ENV && !VALID_APP_ENVS.has(env.APP_ENV.trim().toLowerCase())) {
  warnings.push({
    key: "APP_ENV",
    message: `Valor inusual: "${env.APP_ENV}". Valores esperados: ${[...VALID_APP_ENVS].join(", ")}`,
  });
}

// --- DATABASE_URL ---
if (env.DATABASE_URL) {
  if (!isValidPostgresUrl(env.DATABASE_URL)) {
    errors.push({
      key: "DATABASE_URL",
      message:
        'Debe ser URL PostgreSQL válida (postgresql://... o postgres://...). SQLite no es soportado.',
    });
  }
  // En producción, advertir si usa credenciales por defecto
  if (isProduction && /hammer:hammer@/.test(env.DATABASE_URL)) {
    warnings.push({
      key: "DATABASE_URL",
      message:
        "Parece usar credenciales por defecto de desarrollo (hammer:hammer). Cambiar para producción.",
    });
  }
} else if (isProduction) {
  errors.push({
    key: "DATABASE_URL",
    message:
      "Obligatoria en producción. Formato: postgresql://USER:PASS@HOST:5432/DB_NAME",
  });
} else {
  warnings.push({
    key: "DATABASE_URL",
    message: "No definida. Se necesita para ejecutar la aplicación.",
  });
}

// --- AUTH_SESSION_SECRET ---
if (env.AUTH_SESSION_SECRET) {
  const secret = env.AUTH_SESSION_SECRET.trim();

  if (secret.length < 32) {
    errors.push({
      key: "AUTH_SESSION_SECRET",
      message: `Debe tener mínimo 32 caracteres (actual: ${secret.length}). Generar con: openssl rand -hex 32`,
    });
  }

  if (looksLikePlaceholderSecret(secret)) {
    errors.push({
      key: "AUTH_SESSION_SECRET",
      message:
        '⚠️  Detectado valor placeholder o inseguro. NO usar valores como "CHANGE_ME", "your-secret-here", "secret", etc. Generar uno real con:\n' +
        '       node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    });
  }
} else if (isProduction) {
  errors.push({
    key: "AUTH_SESSION_SECRET",
    message:
      "Obligatoria en producción. Generar con: openssl rand -hex 32",
  });
} else {
  warnings.push({
    key: "AUTH_SESSION_SECRET",
    message:
      'No definida. Ejecutar "npm run local:prepare-env" para generarla automáticamente.',
  });
}

// --- AUTH_SESSION_TTL_HOURS ---
const ttl = env.AUTH_SESSION_TTL_HOURS;
if (!/^\d+$/.test(ttl) || Number(ttl) < 1) {
  errors.push({
    key: "AUTH_SESSION_TTL_HOURS",
    message: `Debe ser entero >= 1 (actual: "${ttl}")`,
  });
} else if (isProduction && Number(ttl) > 24) {
  warnings.push({
    key: "AUTH_SESSION_TTL_HOURS",
    message: `Valor alto para producción (${ttl}h). Considerar <= 12h por seguridad.`,
  });
}

// --- RUN_MIGRATIONS (solo informativo en producción) ---
if (isProduction && env.RUN_MIGRATIONS === "") {
  warnings.push({
    key: "RUN_MIGRATIONS",
    message:
      'No definida. Por defecto no se ejecutarán migraciones al iniciar. Usar "true" para auto-migrar.',
  });
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------
const separator = "─".repeat(60);

if (warnings.length > 0) {
  console.warn(`\n⚠️  ADVERTENCIAS DE ENTORNO (${warnings.length}):`);
  console.warn(separator);
  for (const w of warnings) {
    console.warn(`  ⚠  ${w.key}: ${w.message}`);
  }
  console.warn("");
}

if (errors.length > 0) {
  console.error(`\n❌ ERRORES DE VALIDACIÓN DE ENTORNO (${errors.length}):`);
  console.error(separator);
  for (const e of errors) {
    console.error(`  ✖  ${e.key}: ${e.message}`);
  }
  console.error("");
  console.error(`  Contexto: npm run ${lifecycle}`);
  console.error(`  Modo: ${validationMode}`);
  console.error(`  Plantilla de referencia: ${examplePath}`);

  if (!hasAnyEnvFile) {
    console.error(
      "\n  💡 No se encontró archivo .env ni .env.production."
    );
    console.error("     Para desarrollo:  cp .env.example .env");
    console.error(
      "     Para producción:  cp .env.production.example .env.production"
    );
  }

  if (errors.some((e) => e.key === "AUTH_SESSION_SECRET")) {
    console.error("\n  🔑 Generar AUTH_SESSION_SECRET seguro:");
    console.error(
      '     node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
    console.error("     openssl rand -hex 32");
    console.error(
      '     python3 -c "import secrets; print(secrets.token_hex(32))"'
    );
  }

  console.error("");

  if (validationMode === "strict") {
    console.error("  🚫 Modo estricto: abortando ejecución.\n");
    process.exit(1);
  }

  console.warn(
    "  ⚡ Modo warn: continuando con advertencias (NO recomendado para producción).\n"
  );
  process.exit(0);
}

console.log(
  `✅ ENV_VALIDATION_OK (mode=${validationMode}, node_env=${nodeEnv}, app_env=${env.APP_ENV || "n/a"})`
);
