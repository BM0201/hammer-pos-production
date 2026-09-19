import { prisma } from "@/lib/prisma";

/**
 * Fase 0 (prompt-flujo-velocidad.md): instrumentación temporal para medir
 * cantidad de consultas SQL y tiempo por request en las rutas más
 * calientes (checkout, catálogo, command center) y así tener una línea
 * base real contra la cual medir cada fase de optimización.
 *
 * Se activa solo con INSTRUMENT_QUERIES=1 — costo cero (ni el listener se
 * registra) cuando la variable no está puesta, que es el caso normal en
 * producción. El contador es un único listener global de PrismaClient, no
 * aislado por request: sirve para medir a mano contra un server local
 * atendiendo una petición a la vez (así se midió cada fase), no para
 * observabilidad bajo tráfico concurrente real.
 */
let queryCount = 0;
let queryDbMs = 0;
let listenerAttached = false;

export const queryInstrumentationEnabled = process.env.INSTRUMENT_QUERIES === "1";

function ensureListener() {
  if (listenerAttached || !queryInstrumentationEnabled) return;
  listenerAttached = true;
  (prisma as unknown as { $on: (event: "query", cb: (e: { duration: number }) => void) => void }).$on(
    "query",
    (event) => {
      queryCount += 1;
      queryDbMs += event.duration;
    },
  );
}

export async function withQueryInstrumentation<T>(routeName: string, handler: () => Promise<T>): Promise<T> {
  if (!queryInstrumentationEnabled) return handler();
  ensureListener();
  queryCount = 0;
  queryDbMs = 0;
  const startedAt = Date.now();
  try {
    return await handler();
  } finally {
    const totalMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console -- medición deliberada, solo con el flag activo
    console.log(`[perf] ${routeName} queries=${queryCount} dbMs=${queryDbMs} totalMs=${totalMs}`);
  }
}
