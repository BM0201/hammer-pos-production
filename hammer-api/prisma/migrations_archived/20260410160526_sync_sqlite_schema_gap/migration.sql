-- CreateTable
CREATE TABLE "CashClosure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "closureDate" DATETIME NOT NULL,
    "closedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closureType" TEXT NOT NULL,
    "totalSales" DECIMAL NOT NULL DEFAULT 0,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "cashTotal" DECIMAL NOT NULL DEFAULT 0,
    "cardTotal" DECIMAL NOT NULL DEFAULT 0,
    "transferTotal" DECIMAL NOT NULL DEFAULT 0,
    "creditTotal" DECIMAL NOT NULL DEFAULT 0,
    "mixedTotal" DECIMAL NOT NULL DEFAULT 0,
    "productsSold" INTEGER NOT NULL DEFAULT 0,
    "reportJson" JSONB,
    "isReopened" BOOLEAN NOT NULL DEFAULT false,
    "reopenedAt" DATETIME,
    "reopenedByUserId" TEXT,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "emergencySalesCount" INTEGER NOT NULL DEFAULT 0,
    "maxEmergencySales" INTEGER NOT NULL DEFAULT 3,
    "isPermanentlyClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CashClosure_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CashClosureLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cashClosureId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "performedByUserId" TEXT,
    "metadataJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashClosureLog_cashClosureId_fkey" FOREIGN KEY ("cashClosureId") REFERENCES "CashClosure" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "attemptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "RevokedSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "revokedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "reason" TEXT
);

-- CreateTable
CREATE TABLE "CsrfToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TransportService" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saleOrderId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "reference" TEXT,
    "price" DECIMAL NOT NULL,
    "scheduledPaymentTime" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deliveredAt" DATETIME,
    CONSTRAINT "TransportService_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "SaleOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransportService_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransportService_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "globalRole" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "email", "fullName", "globalRole", "id", "isActive", "passwordHash", "updatedAt", "username") SELECT "createdAt", "email", "fullName", "globalRole", "id", "isActive", "passwordHash", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_globalRole_isActive_idx" ON "User"("globalRole", "isActive");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CashClosure_branchId_closureDate_idx" ON "CashClosure"("branchId", "closureDate");

-- CreateIndex
CREATE INDEX "CashClosure_closureType_idx" ON "CashClosure"("closureType");

-- CreateIndex
CREATE UNIQUE INDEX "CashClosure_branchId_closureDate_key" ON "CashClosure"("branchId", "closureDate");

-- CreateIndex
CREATE INDEX "CashClosureLog_cashClosureId_createdAt_idx" ON "CashClosureLog"("cashClosureId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_identifier_attemptedAt_idx" ON "LoginAttempt"("identifier", "attemptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RevokedSession_tokenHash_key" ON "RevokedSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RevokedSession_tokenHash_idx" ON "RevokedSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RevokedSession_expiresAt_idx" ON "RevokedSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CsrfToken_token_key" ON "CsrfToken"("token");

-- CreateIndex
CREATE INDEX "CsrfToken_token_idx" ON "CsrfToken"("token");

-- CreateIndex
CREATE INDEX "CsrfToken_expiresAt_idx" ON "CsrfToken"("expiresAt");

-- CreateIndex
CREATE INDEX "TransportService_branchId_status_idx" ON "TransportService"("branchId", "status");

-- CreateIndex
CREATE INDEX "TransportService_saleOrderId_idx" ON "TransportService"("saleOrderId");
