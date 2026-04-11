#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const root = process.cwd();
const envPath = path.join(root, ".env");
const envExamplePath = path.join(root, ".env.example");
const CANONICAL_SQLITE_URL = "file:./dev.db";

function parseEnv(raw) {
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

function upsertEnvValue(fileContents, key, value) {
  const lines = fileContents.split(/\r?\n/);
  const nextValue = `"${value}"`;
  let updated = false;
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return line;
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
    normalized.includes("replace_with_a_very_long_random_secret_value_min_32_chars") ||
    normalized.includes("change_me") ||
    normalized.includes("changeme")
  );
}

if (!fs.existsSync(envPath)) {
  fs.copyFileSync(envExamplePath, envPath);
  console.log("[local:prepare-env] .env no existía. Se creó desde .env.example");
}

let envRaw = fs.readFileSync(envPath, "utf8");
let env = parseEnv(envRaw);

if (env.DATABASE_URL !== CANONICAL_SQLITE_URL) {
  envRaw = upsertEnvValue(envRaw, "DATABASE_URL", CANONICAL_SQLITE_URL);
  env = parseEnv(envRaw);
  console.log(`[local:prepare-env] DATABASE_URL ajustada a ruta canónica: ${CANONICAL_SQLITE_URL}`);
}

if (!env.AUTH_SESSION_SECRET || env.AUTH_SESSION_SECRET.length < 32 || isPlaceholderSecret(env.AUTH_SESSION_SECRET)) {
  const generatedSecret = randomBytes(32).toString("hex");
  envRaw = upsertEnvValue(envRaw, "AUTH_SESSION_SECRET", generatedSecret);
  console.log("[local:prepare-env] AUTH_SESSION_SECRET insegura/ausente detectada. Se generó una nueva clave local segura.");
}

fs.writeFileSync(envPath, envRaw, "utf8");
console.log("[local:prepare-env] OK");
