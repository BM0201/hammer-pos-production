#!/usr/bin/env bash
set -euo pipefail

npm run env:validate
npm run prisma:generate
npm run typecheck
npm run build
npm run verify:sales
npm run verify:payments
npm run verify:phase6
npm run verify:phase7
npm run test:e2e
