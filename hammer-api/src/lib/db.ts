import { prisma, isDatabaseConfigured } from "@/lib/prisma";

/**
 * Verifica la conectividad real con PostgreSQL ejecutando una consulta simple.
 * Incluye timeout para evitar bloqueos prolongados.
 *
 * @param timeoutMs — Tiempo máximo de espera en milisegundos (default: 5000)
 * @returns true si la base de datos responde, false en caso contrario
 */
export async function checkDatabaseConnectivity(
  timeoutMs = 5000,
): Promise<boolean> {
  if (!isDatabaseConfigured()) {
    return false;
  }

  try {
    const result = await Promise.race([
      prisma.$queryRaw`SELECT 1 AS ok`,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Database connectivity check timed out")), timeoutMs),
      ),
    ]);

    return Array.isArray(result) && result.length > 0;
  } catch {
    return false;
  }
}
