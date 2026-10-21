import { defineConfig, devices } from "@playwright/test";

const apiURL = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";
const frontendURL = process.env.E2E_FRONTEND_URL ?? "http://127.0.0.1:3000";

/**
 * prompt-inventario-unificado.md Commit 1 — hasta acá, los E2E de este
 * repo SOLO llamaban a la API por HTTP (fixture `request`, sin navegador
 * real — ver tests/e2e/production-flow.spec.ts). El doc pide un E2E de
 * verdad: clic en cada pestaña/subpestaña de la barra de Inventario,
 * verificar que la URL cambia y que el contenido es distinto. Eso necesita
 * un navegador de verdad contra el FRONTEND corriendo — infraestructura
 * nueva, dos proyectos separados:
 *
 *  - "api"  (ya existía): tests/e2e — HTTP puro contra hammer-api.
 *  - "ui"   (nuevo): tests/e2e-ui — navegador real (Chromium) contra
 *    hammer-frontend, que a su vez proxea /api/* a hammer-api (mismo
 *    origen — las cookies de sesión funcionan solas, ver next.config.ts).
 *
 * `webServer` arranca los DOS servidores de dev (API en :4000, frontend en
 * :3000) — compartidos entre proyectos, nunca contra producción.
 */
export default defineConfig({
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  projects: [
    {
      name: "api",
      testDir: "./tests/e2e",
      use: {
        baseURL: apiURL,
        extraHTTPHeaders: {
          "Accept": "application/json",
        },
      },
    },
    {
      name: "ui",
      testDir: "./tests/e2e-ui",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: frontendURL,
      },
    },
  ],
  webServer: [
    {
      command: "npm --prefix ../hammer-api run dev",
      url: `${apiURL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET ?? "e2e-auth-session-secret-at-least-32-characters",
        CRON_SECRET: process.env.CRON_SECRET ?? "e2e-cron-secret",
        NODE_ENV: process.env.NODE_ENV ?? "development",
      },
    },
    {
      command: "npm run dev",
      url: frontendURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: process.env.NODE_ENV ?? "development",
      },
    },
  ],
});
