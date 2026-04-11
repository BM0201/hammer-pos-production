#!/usr/bin/env node
import { checkHttp, emitAndExit, summarize } from "./_common.mjs";

const startedAt = new Date().toISOString();

const checks = [
  await checkHttp({
    name: "pos_api_reachability",
    path: "/api/sales/orders",
    expectedStatuses: [400, 401, 403, 405],
  }),
  await checkHttp({
    name: "cash_session_reachability",
    path: "/api/cashier/cash-sessions/active",
    expectedStatuses: [401, 403, 405],
  }),
  await checkHttp({
    name: "dispatch_api_reachability",
    path: "/api/warehouse/dispatch/pending",
    expectedStatuses: [401, 403, 405],
  }),
];

emitAndExit(summarize(checks, "functional", startedAt));
