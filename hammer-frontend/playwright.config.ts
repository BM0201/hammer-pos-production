import { defineConfig } from "@playwright/test";

const apiURL = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: apiURL,
    extraHTTPHeaders: {
      "Accept": "application/json",
    },
  },
  webServer: {
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
});
