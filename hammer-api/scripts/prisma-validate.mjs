import { spawnSync } from "node:child_process";

const fallbackUrl = "postgresql://user:pass@localhost:5432/hammer_validate";
const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || fallbackUrl,
  DIRECT_URL: process.env.DIRECT_URL || process.env.DATABASE_URL || fallbackUrl,
};

const result = spawnSync("prisma", ["validate"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env,
});

process.exit(result.status ?? 1);
