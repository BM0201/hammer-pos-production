import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const storageState = process.env.E2E_ADMIN_STORAGE_STATE ?? "tests/e2e/.auth/admin.json";

// Credentials are sourced in global setup from:
// E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_CASHIER_EMAIL, E2E_CASHIER_PASSWORD

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: process.env.CI ? 1 : undefined,
  globalSetup: "./scripts/e2e/global-setup.ts",
  use: {
    baseURL,
    storageState,
    trace: "retain-on-failure",
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["./tests/e2e/reporter/latency-reporter.ts"],
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
