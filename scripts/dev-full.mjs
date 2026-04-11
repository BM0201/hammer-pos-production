#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const root = process.cwd();
const isWindows = process.platform === "win32";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: root,
    env: process.env,
    shell: isWindows,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npm", ["install", "--no-audit", "--no-fund"]);
run("npm", ["run", "local:doctor"]);
run("npm", ["run", "bootstrap:check"]);
run("npm", ["run", "seed"]);
run("npm", ["run", "dev"]);
