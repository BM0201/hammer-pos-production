CREATE TABLE "UserPresence" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT,
  "branchId" TEXT,
  "username" TEXT,
  "roleCode" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ONLINE',
  "currentPath" TEXT,
  "currentModule" TEXT,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disconnectedAt" TIMESTAMP(3),
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserPresence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserPresence_userId_key" ON "UserPresence"("userId");
CREATE INDEX "UserPresence_branchId_idx" ON "UserPresence"("branchId");
CREATE INDEX "UserPresence_status_idx" ON "UserPresence"("status");
CREATE INDEX "UserPresence_lastSeenAt_idx" ON "UserPresence"("lastSeenAt");

ALTER TABLE "UserPresence"
  ADD CONSTRAINT "UserPresence_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserPresence"
  ADD CONSTRAINT "UserPresence_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
