-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SaleOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNumber" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "subtotal" DECIMAL NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL NOT NULL DEFAULT 0,
    "requiresTransport" BOOLEAN NOT NULL DEFAULT false,
    "transportAmount" DECIMAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SaleOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SaleOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SaleOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SaleOrder" ("branchId", "createdAt", "createdByUserId", "customerId", "discountTotal", "grandTotal", "id", "notes", "orderNumber", "requiresTransport", "status", "subtotal", "taxTotal", "updatedAt") SELECT "branchId", "createdAt", "createdByUserId", "customerId", "discountTotal", "grandTotal", "id", "notes", "orderNumber", "requiresTransport", "status", "subtotal", "taxTotal", "updatedAt" FROM "SaleOrder";
DROP TABLE "SaleOrder";
ALTER TABLE "new_SaleOrder" RENAME TO "SaleOrder";
CREATE UNIQUE INDEX "SaleOrder_orderNumber_key" ON "SaleOrder"("orderNumber");
CREATE INDEX "SaleOrder_branchId_status_idx" ON "SaleOrder"("branchId", "status");
CREATE INDEX "SaleOrder_customerId_createdAt_idx" ON "SaleOrder"("customerId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
