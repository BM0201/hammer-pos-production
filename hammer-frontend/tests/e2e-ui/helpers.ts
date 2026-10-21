import type { BrowserContext } from "@playwright/test";
import { readE2EState, type E2EState } from "../e2e/helpers";

export { readE2EState, type E2EState };

/**
 * prompt-inventario-unificado.md Commit 1 — login para los E2E de
 * navegador: autentica por API (misma ruta que los E2E de hammer-api,
 * `/api/auth/login`) usando `context.request`, que comparte cookies con
 * cualquier `page` creada desde el mismo `context` — las páginas quedan
 * logueadas sin pasar por el formulario de login. El frontend proxea
 * `/api/*` al backend en el MISMO origen (next.config.ts), así que la
 * cookie de sesión aplica igual que si hubiera entrado por la UI.
 */
export async function loginAsMasterInBrowser(context: BrowserContext, state: E2EState = readE2EState()): Promise<void> {
  const response = await context.request.post("/api/auth/login", {
    data: { username: state.credentials.master.username, password: state.credentials.master.password },
  });
  if (!response.ok()) {
    throw new Error(`Login E2E (UI) falló: ${response.status()} ${await response.text()}`);
  }
}
