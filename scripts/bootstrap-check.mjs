#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const isWindows = process.platform === "win32";
const binDir = path.join(root, "node_modules", ".bin");

function fail(code, message) {
  console.error(`BOOTSTRAP_CHECK_FAILED: ${message}`);
  process.exit(code);
}

function ensureBin(binName) {
  const candidate = isWindows
    ? path.join(binDir, `${binName}.cmd`)
    : path.join(binDir, binName);
  if (!fs.existsSync(candidate)) {
    fail(2, `missing_cli_${binName}`);
  }
}

function runNpmScript(scriptName) {
  const result = spawnSync("npm", ["run", scriptName], {
    stdio: "inherit",
    shell: isWindows,
    cwd: root,
    env: process.env,
  });

  if (result.status !== 0) {
    fail(10, `script_failed_${scriptName}`);
  }
}

if (!fs.existsSync(path.join(root, "node_modules"))) {
  fail(1, "dependencies_not_installed_run_npm_install");
}

if (!fs.existsSync(path.join(root, "package-lock.json"))) {
  fail(1, "package_lock_missing_run_npm_install_to_generate_lockfile");
}

ensureBin("next");
ensureBin("prisma");
ensureBin("tsx");

runNpmScript("env:validate");
runNpmScript("prisma:generate");

console.log("BOOTSTRAP_CHECK_OK");
