import { PrismaClient, Prisma } from "@prisma/client";
import { envStatus, logRuntimeEnvWarnings } from "@/lib/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export class MissingDatabaseUrlError extends Error {
  constructor() {
    super("DATABASE_URL no está configurada. No se puede inicializar PrismaClient.");
    this.name = "MissingDatabaseUrlError";
  }
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

  const client = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

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
