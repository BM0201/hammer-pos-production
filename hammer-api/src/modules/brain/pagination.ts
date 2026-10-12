/**
 * prompt-completo-pendientes-2026-10.md Parte A 1.2 — "ningún detector
 * truncado cierra nada". `capped` (en BrainScanDetectorSummary) solo
 * contaba cuántas DECISIONES salían de un detector, nunca cuántas
 * ENTIDADES leyó: un `findMany({ take: 1000 })` que de verdad tiene 1200
 * filas en la tabla se queda calladamente con las primeras 1000 y el
 * detector nunca se entera. Con eso, el auto-cierre ("la condición ya no
 * se detecta") se dispara sobre una MUESTRA, no sobre el dominio completo.
 *
 * `paginateAll` reemplaza un `findMany({ take: N })` sin tope real por un
 * recorrido página por página con cursor, dentro de un `deadlineAt` (del
 * `timeoutMs` del detector) — si se acaba el tiempo antes de agotar las
 * filas, devuelve `truncated: true` y lo que alcanzó a leer (nunca lanza:
 * un detector truncado sigue pudiendo reportar lo que sí vio).
 */
export async function paginateAll<T>(
  fetchPage: (cursor: string | null) => Promise<T[]>,
  getId: (row: T) => string,
  opts: { pageSize: number; deadlineAt: number },
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let cursor: string | null = null;

  while (true) {
    if (Date.now() > opts.deadlineAt) return { rows, truncated: true };
    const page = await fetchPage(cursor);
    rows.push(...page);
    if (page.length < opts.pageSize) return { rows, truncated: false };
    cursor = getId(page[page.length - 1]);
  }
}
