-- Migration: MFA fields + SecurityAlert + MfaPendingToken
-- 2026-06-17

-- ── Enums ─────────────────────────────────────────────────────────────
CREATE TYPE "AlertSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "AlertStatus"   AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- ── MFA fields on User ────────────────────────────────────────────────
ALTER TABLE "User"
  ADD COLUMN "mfaEnabled"       BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN "mfaSecret"        TEXT,
  ADD COLUMN "mfaRecoveryCodes" JSONB,
  ADD COLUMN "mfaEnabledAt"     TIMESTAMP(3);

-- ── MfaPendingToken ───────────────────────────────────────────────────
CREATE TABLE "MfaPendingToken" (
  "id"        TEXT NOT NULL,
  "token"     TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MfaPendingToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MfaPendingToken_token_key" ON "MfaPendingToken"("token");
CREATE INDEX "MfaPendingToken_token_idx"     ON "MfaPendingToken"("token");
CREATE INDEX "MfaPendingToken_expiresAt_idx" ON "MfaPendingToken"("expiresAt");

-- ── SecurityAlert ─────────────────────────────────────────────────────
CREATE TABLE "SecurityAlert" (
  "id"             TEXT NOT NULL,
  "severity"       "AlertSeverity" NOT NULL,
  "type"           TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "description"    TEXT NOT NULL,
  "actorUserId"    TEXT,
  "branchId"       TEXT,
  "entityType"     TEXT,
  "entityId"       TEXT,
  "metadataJson"   JSONB,
  "status"         "AlertStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedBy" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedBy"     TEXT,
  "resolvedAt"     TIMESTAMP(3),
  "note"           TEXT,

  CONSTRAINT "SecurityAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecurityAlert_severity_status_idx" ON "SecurityAlert"("severity", "status");
CREATE INDEX "SecurityAlert_createdAt_idx"       ON "SecurityAlert"("createdAt");
CREATE INDEX "SecurityAlert_type_idx"            ON "SecurityAlert"("type");
CREATE INDEX "SecurityAlert_actorUserId_idx"     ON "SecurityAlert"("actorUserId");
