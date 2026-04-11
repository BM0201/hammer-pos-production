#!/usr/bin/env node
import { checkHttp, emitAndExit, summarize } from "./_common.mjs";

const startedAt = new Date().toISOString();

const checks = [
  await checkHttp({
    name: "app_readiness",
    path: "/login",
    expectedStatuses: [200],
  }),
  await checkHttp({
    name: "db_readiness_via_auth",
    path: "/api/auth/login",
    method: "POST",
    body: { username: "nonexistent_user", password: "invalid-password" },
    expectedStatuses: [401],
  }),
  await checkHttp({
    name: "session_layer_reachability",
    path: "/api/auth/session",
    expectedStatuses: [200, 401],
  }),
];

emitAndExit(summarize(checks, "infrastructure", startedAt));
