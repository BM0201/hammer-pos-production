/**
 * prompt-seguridad-basica.md Fase 3.4 — varias rutas de listado leían
 * `searchParams.get("limit")` y lo pasaban a Prisma `take` sin validar ni
 * acotar: un `?limit=999999` (o `?limit=abc`, que Prisma rechaza con un
 * error poco claro) podía forzar un `take` gigante o romper la query.
 * Única función para parsear ese parámetro en todas las rutas de listado —
 * nunca un número distinto por ruta.
 */
export function parseListLimit(
  raw: string | null | undefined,
  opts: { default: number; max?: number },
): number {
  const max = opts.max ?? 200;

  if (raw == null) return opts.default;
  const trimmed = raw.trim();
  if (trimmed === "") return opts.default;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return opts.default;

  return Math.min(Math.floor(parsed), max);
}
