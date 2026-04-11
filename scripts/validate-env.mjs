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

const fileEnv = parseDotEnvFile(envPath);
const read = (key, fallback) => process.env[key] ?? fileEnv[key] ?? fallback;
const lifecycle = process.env.npm_lifecycle_event ?? "unknown";
const hasEnvFile = fs.existsSync(envPath);

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
if (!env.DATABASE_URL) errors.DATABASE_URL = "Required";
if (typeof env.DATABASE_URL === "string" && env.DATABASE_URL.startsWith("file:") && env.DATABASE_URL !== "file:./dev.db") {
  errors.DATABASE_URL = "SQLite local path must be canonical: file:./dev.db";
}
if (!env.AUTH_SESSION_SECRET || env.AUTH_SESSION_SECRET.length < 32) errors.AUTH_SESSION_SECRET = "Must have 32+ chars";
if (!/^\d+$/.test(env.AUTH_SESSION_TTL_HOURS) || Number(env.AUTH_SESSION_TTL_HOURS) < 1) errors.AUTH_SESSION_TTL_HOURS = "Must be integer >= 1";
if (
  typeof env.AUTH_SESSION_SECRET === "string" &&
  (
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
    console.error("Hint: for local SQLite use DATABASE_URL=\"file:./dev.db\"");
  }
  process.exit(1);
}

console.log("ENV_VALIDATION_OK");
