# Release & Pilot Readiness Contract

This contract defines the minimum deployment safety gates before promoting H.A.M.M.E.R. builds.

## Ready for Staging (must pass all)
1. `npm run env:validate`
2. Prisma readiness:
   - `npm run prisma:generate`
   - `npm run prisma:migrate:deploy`
3. Build and static checks:
   - `npm run typecheck`
   - `npm run build`
   - `npm run verify:sales`
   - `npm run verify:payments`
   - `npm run verify:phase6`
   - `npm run verify:phase7`
4. E2E execution:
   - `npm run test:e2e`
5. Metrics regression check:
   - `npm run metrics:compare`
   - must satisfy threshold config (`config/metrics/e2e-latency-thresholds.json`)
6. Infrastructure smoke:
   - `npm run smoke:infra`

## Ready for Pilot (must pass all)
All staging criteria, plus:
1. Functional smoke:
   - `npm run smoke:functional`
2. Readiness contract artifact generated:
   - `artifacts/release/readiness-contract.json`
   - `result.readyForPilot` must be `true`

## Canonical release command
```bash
npm run release:check
```

This command executes the full release contract and fails on first contract breach.

## Artifacts generated
- `artifacts/metrics/e2e-latency.json`
- `artifacts/metrics/e2e-latency-comparison.json`
- `artifacts/smoke/infra-smoke.json`
- `artifacts/smoke/functional-smoke.json`
- `artifacts/release/readiness-contract.json`
- `artifacts/release/release-start.log`


## Live validation sequence (recommended)
```bash
bash scripts/live-release-validation.sh
```

This command starts DB and runs `release:check` in isolated container runtime to avoid host drift.

- `artifacts/release/live-validation-result.json`
- `artifacts/release/live-validation-artifacts.tar.gz`
