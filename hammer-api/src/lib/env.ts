import { z } from "zod";

const VALID_NODE_ENVS = new Set(["development", "test", "production"]);
const PLACEHOLDER_SECRET_PATTERNS = ["replace_with", "change_me", "changeme", "example", "sample"];

function resolveNodeEnv(): "development" | "test" | "production" {
  const raw = process.env.NODE_ENV?.trim().toLowerCase() ?? "development";
  if (VALID_NODE_ENVS.has(raw)) {
    return raw as "development" | "test" | "production";
  }
  return "development";
}

function validateDatabaseUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const parsed = z.string().url("DATABASE_URL debe ser una URL válida").safeParse(trimmed);
  if (!parsed.success) {
    throw new Error("DATABASE_URL debe ser una URL válida");
  }

  if (!trimmed.startsWith("postgresql://") && !trimmed.startsWith("postgres://")) {
    throw new Error("DATABASE_URL debe usar PostgreSQL (postgresql:// o postgres://)");
  }

  return trimmed;
}

function hasPlaceholderSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (["secret", "development", "password", "default"].includes(normalized)) {
    return true;
  }

  return PLACEHOLDER_SECRET_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function validateAuthSecret(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length < 32) {
    throw new Error("AUTH_SESSION_SECRET debe tener mínimo 32 caracteres");
  }

  if (hasPlaceholderSecret(trimmed)) {
    throw new Error("AUTH_SESSION_SECRET no puede usar placeholders/defaults");
  }

  return trimmed;
}

const ttlSchema = z.coerce.number().int().min(1, "AUTH_SESSION_TTL_HOURS debe ser entero >= 1");
const nodeEnv = resolveNodeEnv();
const isProduction = nodeEnv === "production";

export type EnvIssue = {
  key: string;
  message: string;
};

const issues: EnvIssue[] = [];

let databaseUrl: string | undefined;
try {
  databaseUrl = validateDatabaseUrl(process.env.DATABASE_URL);
} catch (error) {
  issues.push({ key: "DATABASE_URL", message: error instanceof Error ? error.message : "Valor inválido" });
}

let authSessionSecret: string | undefined;
try {
  authSessionSecret = validateAuthSecret(process.env.AUTH_SESSION_SECRET);
} catch (error) {
  issues.push({ key: "AUTH_SESSION_SECRET", message: error instanceof Error ? error.message : "Valor inválido" });
}

if (isProduction && !databaseUrl) {
  issues.push({ key: "DATABASE_URL", message: "DATABASE_URL es obligatoria en producción" });
}

if (isProduction && !authSessionSecret) {
  issues.push({ key: "AUTH_SESSION_SECRET", message: "AUTH_SESSION_SECRET es obligatoria en producción" });
}

const ttlParsed = ttlSchema.safeParse(process.env.AUTH_SESSION_TTL_HOURS ?? "12");
if (!ttlParsed.success) {
  issues.push({ key: "AUTH_SESSION_TTL_HOURS", message: ttlParsed.error.issues[0]?.message ?? "Valor inválido" });
}

const devOnlyFallbackAuthSecret = "dev-only-insecure-fallback-auth-secret-not-for-production";

const env = {
  DATABASE_URL: databaseUrl,
  AUTH_SESSION_SECRET: authSessionSecret ?? devOnlyFallbackAuthSecret,
  AUTH_SESSION_TTL_HOURS: ttlParsed.success ? ttlParsed.data : 12,
};

const envStatus = {
  nodeEnv,
  isProduction,
  hasDatabaseUrl: typeof databaseUrl === "string" && databaseUrl.length > 0,
  hasAuthSessionSecret: typeof authSessionSecret === "string" && authSessionSecret.length >= 32,
  isUsingFallbackAuthSecret: !authSessionSecret,
  issues,
};

function buildRuntimeEnvErrorMessage(runtimeIssues: EnvIssue[]): string {
  const details = runtimeIssues.map((issue) => `- ${issue.key}: ${issue.message}`).join("\n");
  return `[env] Configuración inválida en producción. Corrige variables críticas antes de iniciar:\n${details}`;
}

if (isProduction && issues.length > 0) {
  throw new Error(buildRuntimeEnvErrorMessage(issues));
}

let hasLoggedRuntimeEnvWarning = false;

function logRuntimeEnvWarnings(): void {
  if (hasLoggedRuntimeEnvWarning || isProduction) {
    return;
  }

  if (envStatus.issues.length > 0 || envStatus.isUsingFallbackAuthSecret || !envStatus.hasDatabaseUrl) {
    hasLoggedRuntimeEnvWarning = true;
    console.warn("[env] Variables faltantes/inválidas detectadas en modo no productivo. Se permite modo degradado para desarrollo/test.");

    for (const issue of envStatus.issues) {
      console.warn(`[env] ${issue.key}: ${issue.message}`);
    }

    if (envStatus.isUsingFallbackAuthSecret) {
      console.warn("[env] AUTH_SESSION_SECRET ausente/inválido. Se usa fallback SOLO para development/test.");
    }

    if (!envStatus.hasDatabaseUrl) {
      console.warn("[env] DATABASE_URL ausente/inválida. Funcionalidades con BD pueden fallar durante desarrollo/test.");
    }
  }
}

export { env, envStatus, logRuntimeEnvWarnings };
