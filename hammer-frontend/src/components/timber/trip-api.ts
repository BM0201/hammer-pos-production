import { apiFetch, unwrapApiData } from "@/lib/client/api";

export async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

/**
 * Llamada al API de Madera: devuelve los datos o lanza un Error con el mensaje del servidor
 * (ya en español) y su `code`, para decidir sin comparar textos.
 */
export async function timberRequest<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(url, init?.body === undefined ? { method: init?.method } : { method: init.method, body: JSON.stringify(init.body) });
  } catch {
    throw Object.assign(new Error("Sin conexión con el servidor. Revisá el internet e intentá otra vez."), { code: "NETWORK" });
  }
  const raw = await readJson(res);
  if (!res.ok) {
    throw Object.assign(new Error(raw?.error?.message ?? "No se pudo completar la acción."), { code: raw?.error?.code ?? "ERROR" });
  }
  return unwrapApiData(raw) as T;
}

export function errorCode(error: unknown): string {
  return (error as { code?: string })?.code ?? "ERROR";
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "No se pudo completar la acción.";
}
