#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env");
const examplePath = path.join(rootDir, ".env.example");

function parseDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .reduce((acc, line) => {
      const separatorIndex = line.indexOf("=");
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim().replace(/^"|"$/g, "");
      acc[key] = value;
      return acc;
    }, {});
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const isTrue = (value) => typeof value === "string" && TRUE_VALUES.has(value.toLowerCase());

const fileEnv = parseDotEnvFile(envPath);
const read = (key, fallback) => process.env[key] ?? fileEnv[key] ?? fallback;
const lifecycle = process.env.npm_lifecycle_event ?? "unknown";
const hasEnvFile = fs.existsSync(envPath);
const cliMode = process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1];

const envValidationModeFromEnv = process.env.ENV_VALIDATION_MODE;
const skipValidation = isTrue(process.env.SKIP_ENV_VALIDATION);

function resolveValidationMode() {
  if (skipValidation) return "skip";

  const requestedMode = (cliMode ?? envValidationModeFromEnv ?? "auto").toLowerCase();
  if (!["auto", "strict", "warn"].includes(requestedMode)) {
    console.warn(`[env:validate] Unknown mode '${requestedMode}', falling back to auto.`);
    return "auto";
  }

  if (requestedMode !== "auto") return requestedMode;

  const runtimeLikeContext =
    lifecycle === "prestart" ||
    lifecycle === "start" ||
    process.env.APP_ENV === "production" ||
    process.env.NODE_ENV === "production";

  return runtimeLikeContext ? "warn" : "strict";
}

const validationMode = resolveValidationMode();

if (validationMode === "skip") {
  console.log("ENV_VALIDATION_SKIPPED");
  console.log("Reason: SKIP_ENV_VALIDATION=true");
  process.exit(0);
}

const env = {
  DATABASE_URL: read("DATABASE_URL"),
  AUTH_SESSION_SECRET: read("AUTH_SESSION_SECRET"),
  AUTH_SESSION_TTL_HOURS: read("AUTH_SESSION_TTL_HOURS", "12"),
  E2E_BASE_URL: read("E2E_BASE_URL", "http://127.0.0.1:3000"),
  E2E_ADMIN_STORAGE_STATE: read("E2E_ADMIN_STORAGE_STATE", "tests/e2e/.auth/admin.json"),
  E2E_CASHIER_STORAGE_STATE: read("E2E_CASHIER_STORAGE_STATE", "tests/e2e/.auth/cashier.json"),
  E2E_ADMIN_USERNAME: read("E2E_ADMIN_USERNAME", "supervisor.mga"),
  E2E_ADMIN_PASSWORD: read("E2E_ADMIN_PASSWORD", "ChangeMeNow!123"),
  E2E_CASHIER_USERNAME: read("E2E_CASHIER_USERNAME", "caja.mga"),
  E2E_CASHIER_PASSWORD: read("E2E_CASHIER_PASSWORD", "ChangeMeNow!123"),
};

const errors = {};
if (!env.DATABASE_URL) {
  errors.DATABASE_URL = "Required";
} else {
  try {
    const protocol = new URL(env.DATABASE_URL).protocol;
    if (!["postgresql:", "postgres:"].includes(protocol)) {
      errors.DATABASE_URL = "Must use PostgreSQL connection string (postgresql:// or postgres://)";
    }
  } catch {
    errors.DATABASE_URL = "Must be a valid PostgreSQL URL";
  }
}

if (!env.AUTH_SESSION_SECRET || env.AUTH_SESSION_SECRET.length < 32) errors.AUTH_SESSION_SECRET = "Must have 32+ chars";
if (!/^\d+$/.test(env.AUTH_SESSION_TTL_HOURS) || Number(env.AUTH_SESSION_TTL_HOURS) < 1) errors.AUTH_SESSION_TTL_HOURS = "Must be integer >= 1";
if (
  typeof env.AUTH_SESSION_SECRET === "string" &&
  (
    env.AUTH_SESSION_SECRET.includes("replace_with_a_unique_random_secret_min_32_chars") ||
    env.AUTH_SESSION_SECRET.includes("replace_with_a_very_long_random_secret_value_min_32_chars") ||
    env.AUTH_SESSION_SECRET.toLowerCase().includes("change_me") ||
    env.AUTH_SESSION_SECRET.toLowerCase().includes("changeme")
  )
) {
  errors.AUTH_SESSION_SECRET = "Cannot use template/default placeholder. Generate a unique 32+ char secret.";
}

try {
  new URL(env.E2E_BASE_URL);
} catch {
  errors.E2E_BASE_URL = "Must be a valid URL";
}

for (const key of [
  "E2E_ADMIN_STORAGE_STATE",
  "E2E_CASHIER_STORAGE_STATE",
  "E2E_ADMIN_USERNAME",
  "E2E_ADMIN_PASSWORD",
  "E2E_CASHIER_USERNAME",
  "E2E_CASHIER_PASSWORD",
]) {
  if (!env[key]) errors[key] = "Required";
}

if (Object.keys(errors).length > 0) {
  console.error("ENV_VALIDATION_FAILED");
  console.error(errors);
  console.error(`Context: npm run ${lifecycle}`);
  console.error(`Mode: ${validationMode}`);
  console.error(`Expected template: ${examplePath}`);

  if (!hasEnvFile) {
    console.error("Hint: .env file not found.");
    console.error("Create it with: cp .env.example .env");
  }
  if (errors.AUTH_SESSION_SECRET) {
    console.error("Hint: generate a secret with:");
    console.error('node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  if (errors.DATABASE_URL) {
    console.error('Hint: use a PostgreSQL URL, e.g. DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/hammer?schema=public"');
  }

  if (validationMode === "strict") {
    process.exit(1);
  }

  console.warn("ENV_VALIDATION_WARN_ONLY");
  console.warn("Application startup will continue, but features depending on missing variables may fail until env vars are available.");
  process.exit(0);
}

console.log(`ENV_VALIDATION_OK (mode=${validationMode})`);
