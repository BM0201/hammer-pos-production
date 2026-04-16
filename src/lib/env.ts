import { z } from "zod";

const databaseUrlSchema = z
  .string()
  .trim()
  .url("DATABASE_URL debe ser una URL válida")
  .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
    message: "DATABASE_URL debe usar PostgreSQL (postgresql:// o postgres://)",
  })
  .optional();

const envSchema = z.object({
  DATABASE_URL: databaseUrlSchema,
  AUTH_SESSION_SECRET: z.string().min(32, "AUTH_SESSION_SECRET debe tener mínimo 32 caracteres").optional(),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(12),
});

export type EnvIssue = {
  key: string;
  message: string;
};

const fallbackAuthSecret =
  `runtime-fallback-auth-secret-${Date.now()}-${Math.random().toString(36).slice(2)}-not-for-production`;

const parsedEnv = envSchema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET,
  AUTH_SESSION_TTL_HOURS: process.env.AUTH_SESSION_TTL_HOURS ?? "12",
});

const issues: EnvIssue[] = !parsedEnv.success
  ? parsedEnv.error.issues.map((issue) => ({
      key: String(issue.path[0] ?? "ENV"),
      message: issue.message,
    }))
  : [];

const parsedData = parsedEnv.success
  ? parsedEnv.data
  : {
      DATABASE_URL: process.env.DATABASE_URL,
      AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET,
      AUTH_SESSION_TTL_HOURS: 12,
    };

export const env = {
  DATABASE_URL: parsedData.DATABASE_URL,
  AUTH_SESSION_SECRET: parsedData.AUTH_SESSION_SECRET ?? fallbackAuthSecret,
  AUTH_SESSION_TTL_HOURS: parsedData.AUTH_SESSION_TTL_HOURS,
};

export const envStatus = {
  hasDatabaseUrl: typeof parsedData.DATABASE_URL === "string" && parsedData.DATABASE_URL.length > 0,
  hasAuthSessionSecret: typeof parsedData.AUTH_SESSION_SECRET === "string" && parsedData.AUTH_SESSION_SECRET.length >= 32,
  isUsingFallbackAuthSecret: !(typeof parsedData.AUTH_SESSION_SECRET === "string" && parsedData.AUTH_SESSION_SECRET.length >= 32),
  issues,
};

let hasLoggedRuntimeEnvWarning = false;

export function logRuntimeEnvWarnings(): void {
  if (hasLoggedRuntimeEnvWarning) {
    return;
  }

  if (envStatus.issues.length > 0 || envStatus.isUsingFallbackAuthSecret || !envStatus.hasDatabaseUrl) {
    hasLoggedRuntimeEnvWarning = true;
    console.warn("[env] Se detectaron variables de entorno faltantes o inválidas. La app seguirá corriendo en modo degradado.");

    for (const issue of envStatus.issues) {
      console.warn(`[env] ${issue.key}: ${issue.message}`);
    }

    if (envStatus.isUsingFallbackAuthSecret) {
      console.warn("[env] AUTH_SESSION_SECRET ausente/inválido. Se usa un secreto temporal en memoria (solo para evitar crash en runtime).");
    }

    if (!envStatus.hasDatabaseUrl) {
      console.warn("[env] DATABASE_URL ausente/inválida. Funcionalidades que dependen de base de datos pueden responder con error controlado.");
    }
  }
}
