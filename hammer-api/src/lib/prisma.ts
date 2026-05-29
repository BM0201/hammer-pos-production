import { PrismaClient, Prisma } from "@prisma/client";
import { envStatus, logRuntimeEnvWarnings } from "@/lib/env";

/**
 * Prisma client singleton with optional Neon serverless adapter.
 *
 * The Neon adapter (`@prisma/adapter-neon`) is loaded lazily — only when
 * `PRISMA_USE_NEON_ADAPTER === "true"`. This keeps local development with a
 * plain PostgreSQL instance working without installing the adapter.
 *
 * In Vercel production we set:
 *   PRISMA_USE_NEON_ADAPTER=true
 *   DATABASE_URL=postgres://...neon.tech/...?pgbouncer=true  (pooled)
 *   DIRECT_URL=postgres://...neon.tech/...                   (direct, used by `prisma migrate`)
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export class MissingDatabaseUrlError extends Error {
  constructor() {
    super("DATABASE_URL no está configurada. No se puede inicializar PrismaClient.");
    this.name = "MissingDatabaseUrlError";
  }
}

function shouldUseNeonAdapter(): boolean {
  return (process.env.PRISMA_USE_NEON_ADAPTER ?? "").toLowerCase() === "true";
}

function buildPrismaClient(): PrismaClient {
  const log: Prisma.LogLevel[] =
    process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];

  if (shouldUseNeonAdapter()) {
    // Dynamic require so local/dev environments don't need the adapter package.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaNeon } = require("@prisma/adapter-neon");
    const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
    // Cast to avoid coupling this file to generated adapter-specific Prisma options.
    return new PrismaClient({ adapter, log } as unknown as Prisma.PrismaClientOptions);
  }

  return new PrismaClient({ log });
}

function createPrismaClient(): PrismaClient {
  if (!envStatus.hasDatabaseUrl) {
    logRuntimeEnvWarnings();
    throw new MissingDatabaseUrlError();
  }

  const existing = globalForPrisma.prisma;
  if (existing) {
    return existing;
  }

  const client = buildPrismaClient();

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }

  return client;
}

export function isDatabaseConfigured(): boolean {
  return envStatus.hasDatabaseUrl;
}

export function isDatabaseConnectionError(error: unknown): boolean {
  if (error instanceof MissingDatabaseUrlError) {
    return true;
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("can't reach database server") ||
    message.includes("can\u2019t reach database server") ||
    message.includes("database_url") ||
    message.includes("authentication failed")
  );
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = createPrismaClient() as unknown as Record<PropertyKey, unknown>;
    const value = client[property];

    if (typeof value === "function") {
      return value.bind(client);
    }

    return value;
  },
});
