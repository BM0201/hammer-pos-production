import fs from "node:fs/promises";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { request } from "@playwright/test";

type SessionResponse = {
  authenticated: boolean;
  user?: {
    branchIds: string[];
  };
};

type CashBoxResponse = {
  data: Array<{ id: string }>;
};

function toUsernameFromEmail(emailOrUsername: string): string {
  if (!emailOrUsername.includes("@")) return emailOrUsername;
  return emailOrUsername.split("@")[0] ?? emailOrUsername;
}

async function loginAndSaveState(params: {
  baseURL: string;
  storageStatePath: string;
  emailOrUsername: string;
  password: string;
  ensureCashSession?: boolean;
}): Promise<void> {
  const context = await request.newContext({ baseURL: params.baseURL });
  const username = toUsernameFromEmail(params.emailOrUsername);

  const loginResponse = await context.post("/api/auth/login", {
    data: { username, password: params.password },
  });

  if (!loginResponse.ok()) {
    throw new Error(`E2E auth bootstrap failed for ${params.emailOrUsername} with status ${loginResponse.status()}`);
  }

  if (params.ensureCashSession) {
    const sessionResponse = await context.get("/api/auth/session");
    const session = (await sessionResponse.json()) as SessionResponse;
    const branchId = session.user?.branchIds[0];

    if (!branchId) {
      throw new Error(`E2E auth bootstrap did not return branch scope for ${params.emailOrUsername}.`);
    }

    const cashBoxResponse = await context.get(`/api/cashier/cash-boxes?branchId=${branchId}`);
    if (!cashBoxResponse.ok()) {
      throw new Error(`Unable to load cash boxes for branch ${branchId}`);
    }

    const cashBoxes = (await cashBoxResponse.json()) as CashBoxResponse;
    const defaultCashBoxId = cashBoxes.data[0]?.id;

    if (defaultCashBoxId) {
      const openResponse = await context.post("/api/cashier/cash-sessions/open", {
        data: {
          branchId,
          physicalCashBoxId: defaultCashBoxId,
          openingAmount: 5000,
          notes: "Playwright cashier bootstrap session",
        },
      });

      if (![201, 409].includes(openResponse.status())) {
        throw new Error(`Unable to ensure active cash session for ${params.emailOrUsername}. status=${openResponse.status()}`);
      }
    }
  }

  await fs.mkdir(path.dirname(params.storageStatePath), { recursive: true });
  await context.storageState({ path: params.storageStatePath });
  await context.dispose();
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = process.env.E2E_BASE_URL ?? config.projects[0]?.use?.baseURL?.toString() ?? "http://127.0.0.1:3000";
  const adminStoragePath = process.env.E2E_ADMIN_STORAGE_STATE ?? "tests/e2e/.auth/admin.json";
  const cashierStoragePath = process.env.E2E_CASHIER_STORAGE_STATE ?? "tests/e2e/.auth/cashier.json";

  await loginAndSaveState({
    baseURL,
    storageStatePath: adminStoragePath,
    emailOrUsername: process.env.E2E_ADMIN_EMAIL ?? "supervisor.mga@hammer.local",
    password: process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_BOOTSTRAP_PASSWORD ?? process.env.TEST_USER_PASSWORD ?? "ChangeMeNow!123!",
  });

  await loginAndSaveState({
    baseURL,
    storageStatePath: cashierStoragePath,
    emailOrUsername: process.env.E2E_CASHIER_EMAIL ?? "caja.mga@hammer.local",
    password: process.env.E2E_CASHIER_PASSWORD ?? process.env.E2E_BOOTSTRAP_PASSWORD ?? process.env.TEST_USER_PASSWORD ?? "ChangeMeNow!123!",
    ensureCashSession: true,
  });
}
