-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefaultSupplier" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "globalRole" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserBranchRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "roleCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserBranchRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserBranchRole_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PhysicalCashBox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PhysicalCashBox_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CashSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "physicalCashBoxId" TEXT NOT NULL,
    "openedByUserId" TEXT NOT NULL,
    "closedByUserId" TEXT,
    "status" TEXT NOT NULL,
    "openedAt" DATETIME NOT NULL,
    "closedAt" DATETIME,
    "openingAmount" DECIMAL NOT NULL,
    "closingAmount" DECIMAL,
    "notes" TEXT,
    "activeSessionKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CashSession_physicalCashBoxId_fkey" FOREIGN KEY ("physicalCashBoxId") REFERENCES "PhysicalCashBox" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CashSession_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CashSession_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "taxId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CustomerBranchScope" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "isAllowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerBranchScope_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerBranchScope_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerCreditProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "branchId" TEXT,
    "creditLimit" DECIMAL NOT NULL,
    "creditUsed" DECIMAL NOT NULL DEFAULT 0,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerCreditProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerCreditProfile_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "allowsFraction" BOOLEAN NOT NULL DEFAULT false,
    "isTimber" BOOLEAN NOT NULL DEFAULT false,
    "standardSalePrice" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "abcClassification" TEXT,
    "xyzClassification" TEXT,
    "rotationIndex" DECIMAL,
    "averageDailySales" DECIMAL,
    "daysInStock" INTEGER,
    "lastClassificationAt" DATETIME,
    "suggestedMargin" DECIMAL,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TimberProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "timberType" TEXT NOT NULL,
    "thickness" DECIMAL NOT NULL,
    "width" DECIMAL NOT NULL,
    "length" DECIMAL NOT NULL,
    "boardFeet" DECIMAL NOT NULL,
    "baseCost" DECIMAL NOT NULL,
    "pricePerInch" DECIMAL NOT NULL,
    "sellingPrice" DECIMAL NOT NULL,
    "varaLength" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TimberProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TimberPricingConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "costPerFoot" DECIMAL NOT NULL DEFAULT 20,
    "pricePerInchTabla" DECIMAL NOT NULL DEFAULT 8.9,
    "pricePerInchTablilla" DECIMAL NOT NULL DEFAULT 6.9,
    "pricePerInchCuadro" DECIMAL NOT NULL DEFAULT 6.9,
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TimberTrip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripCode" TEXT NOT NULL,
    "destinationBranchId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "woodTripTotalCost" DECIMAL NOT NULL DEFAULT 0,
    "computedCostPerFoot" DECIMAL NOT NULL DEFAULT 0,
    "pricePerInchTabla" DECIMAL NOT NULL DEFAULT 8.9,
    "pricePerInchTablilla" DECIMAL NOT NULL DEFAULT 6.9,
    "pricePerInchCuadro" DECIMAL NOT NULL DEFAULT 6.9,
    "totalPieces" INTEGER NOT NULL DEFAULT 0,
    "totalFeet" DECIMAL NOT NULL DEFAULT 0,
    "totalCost" DECIMAL NOT NULL DEFAULT 0,
    "totalSale" DECIMAL NOT NULL DEFAULT 0,
    "totalProfit" DECIMAL NOT NULL DEFAULT 0,
    "marginPercent" DECIMAL NOT NULL DEFAULT 0,
    "supplierName" TEXT,
    "origin" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TimberTrip_destinationBranchId_fkey" FOREIGN KEY ("destinationBranchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TimberTripLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "timberProductId" TEXT,
    "thicknessIn" INTEGER NOT NULL,
    "widthIn" INTEGER NOT NULL,
    "lengthIn" INTEGER NOT NULL,
    "varaLength" INTEGER NOT NULL,
    "priceGroup" TEXT NOT NULL,
    "pieces" INTEGER NOT NULL DEFAULT 0,
    "calculatedFeet" DECIMAL NOT NULL DEFAULT 0,
    "calculatedCostFeet" DECIMAL NOT NULL DEFAULT 0,
    "calculatedCostPerPiece" DECIMAL NOT NULL DEFAULT 0,
    "calculatedSalePricePerPiece" DECIMAL NOT NULL DEFAULT 0,
    "calculatedSaleTotal" DECIMAL NOT NULL DEFAULT 0,
    "calculatedProfit" DECIMAL NOT NULL DEFAULT 0,
    "calculatedMarginPct" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TimberTripLine_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "TimberTrip" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TimberTripLine_timberProductId_fkey" FOREIGN KEY ("timberProductId") REFERENCES "TimberProduct" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityOnHand" DECIMAL NOT NULL DEFAULT 0,
    "weightedAverageCost" DECIMAL NOT NULL DEFAULT 0,
    "inventoryValue" DECIMAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryBalance_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "movementType" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "unitCost" DECIMAL NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SaleOrder" (
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
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SaleOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SaleOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SaleOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SaleOrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saleOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "unitPrice" DECIMAL NOT NULL,
    "discountAmount" DECIMAL NOT NULL DEFAULT 0,
    "lineSubtotal" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaleOrderLine_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "SaleOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SaleOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saleOrderId" TEXT NOT NULL,
    "cashSessionId" TEXT NOT NULL,
    "receivedByUserId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "amount" DECIMAL NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'NIO',
    "referenceNumber" TEXT,
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "SaleOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DispatchTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saleOrderId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "preparedByUserId" TEXT,
    "dispatchedByUserId" TEXT,
    "dispatchedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DispatchTicket_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "SaleOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DispatchTicket_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DispatchTicket_preparedByUserId_fkey" FOREIGN KEY ("preparedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DispatchTicket_dispatchedByUserId_fkey" FOREIGN KEY ("dispatchedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "branchId" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payloadJson" JSONB,
    "requestedByUserId" TEXT NOT NULL,
    "resolvedByUserId" TEXT,
    "resolvedAt" DATETIME,
    "resolutionNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ApprovalRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ApprovalRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ApprovalRequest_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transferNumber" TEXT NOT NULL,
    "fromBranchId" TEXT NOT NULL,
    "toBranchId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "requestedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" DATETIME,
    "dispatchedAt" DATETIME,
    "receivedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transfer_fromBranchId_fkey" FOREIGN KEY ("fromBranchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transfer_toBranchId_fkey" FOREIGN KEY ("toBranchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transfer_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transfer_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransferLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityRequested" DECIMAL NOT NULL,
    "quantityDispatched" DECIMAL NOT NULL DEFAULT 0,
    "quantityReceived" DECIMAL NOT NULL DEFAULT 0,
    "unitCostSnapshot" DECIMAL NOT NULL,
    CONSTRAINT "TransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransferLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullName" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "monthlySalary" DECIMAL NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Employee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmployeeSalaryHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "month" DATETIME NOT NULL,
    "daysWorked" INTEGER NOT NULL,
    "totalDays" INTEGER NOT NULL,
    "proratedSalary" DECIMAL NOT NULL,
    "fullSalary" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmployeeSalaryHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductAnalytics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "month" DATETIME NOT NULL,
    "totalSales" DECIMAL NOT NULL,
    "unitsSold" INTEGER NOT NULL,
    "averageInventory" DECIMAL NOT NULL,
    "rotationIndex" DECIMAL NOT NULL,
    "abcClass" TEXT NOT NULL,
    "xyzClass" TEXT NOT NULL,
    "salesVariance" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductAnalytics_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OperatingExpense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" DATETIME,
    "createdByUserId" TEXT,
    "employeeId" TEXT,
    "isAutoCalculated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OperatingExpense_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OperatingExpense_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PricingConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "desiredMarginPercent" DECIMAL NOT NULL DEFAULT 30,
    "prorationMethod" TEXT NOT NULL DEFAULT 'BY_QUANTITY',
    "estimatedMonthlyUnits" DECIMAL NOT NULL DEFAULT 1000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PricingConfig_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductPricing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "purchaseCost" DECIMAL NOT NULL,
    "operatingExpensePerUnit" DECIMAL NOT NULL,
    "totalCostPerUnit" DECIMAL NOT NULL,
    "marginPercent" DECIMAL NOT NULL,
    "suggestedPrice" DECIMAL NOT NULL,
    "appliedPrice" DECIMAL,
    "totalMonthlyExpenses" DECIMAL NOT NULL,
    "estimatedMonthlyUnits" DECIMAL NOT NULL,
    "notes" TEXT,
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calculatedByUserId" TEXT,
    CONSTRAINT "ProductPricing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProductPricing_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "branchId" TEXT,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadataJson" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_globalRole_isActive_idx" ON "User"("globalRole", "isActive");

-- CreateIndex
CREATE INDEX "UserBranchRole_userId_isActive_idx" ON "UserBranchRole"("userId", "isActive");

-- CreateIndex
CREATE INDEX "UserBranchRole_branchId_roleCode_isActive_idx" ON "UserBranchRole"("branchId", "roleCode", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UserBranchRole_userId_branchId_roleCode_key" ON "UserBranchRole"("userId", "branchId", "roleCode");

-- CreateIndex
CREATE UNIQUE INDEX "PhysicalCashBox_branchId_code_key" ON "PhysicalCashBox"("branchId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CashSession_activeSessionKey_key" ON "CashSession"("activeSessionKey");

-- CreateIndex
CREATE INDEX "CashSession_physicalCashBoxId_status_idx" ON "CashSession"("physicalCashBoxId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerBranchScope_customerId_branchId_key" ON "CustomerBranchScope"("customerId", "branchId");

-- CreateIndex
CREATE INDEX "CustomerCreditProfile_customerId_scope_idx" ON "CustomerCreditProfile"("customerId", "scope");

-- CreateIndex
CREATE INDEX "CustomerCreditProfile_branchId_isActive_idx" ON "CustomerCreditProfile"("branchId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Category_code_key" ON "Category"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- CreateIndex
CREATE INDEX "Product_abcClassification_idx" ON "Product"("abcClassification");

-- CreateIndex
CREATE INDEX "Product_rotationIndex_idx" ON "Product"("rotationIndex");

-- CreateIndex
CREATE UNIQUE INDEX "TimberProduct_productId_key" ON "TimberProduct"("productId");

-- CreateIndex
CREATE INDEX "TimberProduct_timberType_idx" ON "TimberProduct"("timberType");

-- CreateIndex
CREATE UNIQUE INDEX "TimberTrip_tripCode_key" ON "TimberTrip"("tripCode");

-- CreateIndex
CREATE INDEX "TimberTrip_status_idx" ON "TimberTrip"("status");

-- CreateIndex
CREATE INDEX "TimberTrip_destinationBranchId_idx" ON "TimberTrip"("destinationBranchId");

-- CreateIndex
CREATE INDEX "TimberTripLine_tripId_idx" ON "TimberTripLine"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBalance_branchId_productId_key" ON "InventoryBalance"("branchId", "productId");

-- CreateIndex
CREATE INDEX "InventoryMovement_branchId_productId_createdAt_idx" ON "InventoryMovement"("branchId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_referenceType_referenceId_idx" ON "InventoryMovement"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "InventoryMovement_movementType_createdAt_idx" ON "InventoryMovement"("movementType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SaleOrder_orderNumber_key" ON "SaleOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "SaleOrder_branchId_status_idx" ON "SaleOrder"("branchId", "status");

-- CreateIndex
CREATE INDEX "SaleOrder_customerId_createdAt_idx" ON "SaleOrder"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "SaleOrderLine_saleOrderId_idx" ON "SaleOrderLine"("saleOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleOrderLine_saleOrderId_productId_key" ON "SaleOrderLine"("saleOrderId", "productId");

-- CreateIndex
CREATE INDEX "Payment_cashSessionId_paidAt_idx" ON "Payment"("cashSessionId", "paidAt");

-- CreateIndex
CREATE INDEX "DispatchTicket_branchId_status_idx" ON "DispatchTicket"("branchId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_branchId_status_type_idx" ON "ApprovalRequest"("branchId", "status", "type");

-- CreateIndex
CREATE INDEX "ApprovalRequest_referenceType_referenceId_idx" ON "ApprovalRequest"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_transferNumber_key" ON "Transfer"("transferNumber");

-- CreateIndex
CREATE INDEX "Transfer_fromBranchId_toBranchId_status_idx" ON "Transfer"("fromBranchId", "toBranchId", "status");

-- CreateIndex
CREATE INDEX "TransferLine_transferId_idx" ON "TransferLine"("transferId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferLine_transferId_productId_key" ON "TransferLine"("transferId", "productId");

-- CreateIndex
CREATE INDEX "Employee_branchId_idx" ON "Employee"("branchId");

-- CreateIndex
CREATE INDEX "Employee_isActive_idx" ON "Employee"("isActive");

-- CreateIndex
CREATE INDEX "EmployeeSalaryHistory_month_idx" ON "EmployeeSalaryHistory"("month");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeSalaryHistory_employeeId_month_key" ON "EmployeeSalaryHistory"("employeeId", "month");

-- CreateIndex
CREATE INDEX "ProductAnalytics_month_idx" ON "ProductAnalytics"("month");

-- CreateIndex
CREATE INDEX "ProductAnalytics_abcClass_idx" ON "ProductAnalytics"("abcClass");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAnalytics_productId_month_key" ON "ProductAnalytics"("productId", "month");

-- CreateIndex
CREATE INDEX "OperatingExpense_branchId_isActive_idx" ON "OperatingExpense"("branchId", "isActive");

-- CreateIndex
CREATE INDEX "OperatingExpense_category_idx" ON "OperatingExpense"("category");

-- CreateIndex
CREATE UNIQUE INDEX "PricingConfig_branchId_key" ON "PricingConfig"("branchId");

-- CreateIndex
CREATE INDEX "ProductPricing_productId_branchId_calculatedAt_idx" ON "ProductPricing"("productId", "branchId", "calculatedAt");

-- CreateIndex
CREATE INDEX "ProductPricing_branchId_calculatedAt_idx" ON "ProductPricing"("branchId", "calculatedAt");

-- CreateIndex
CREATE INDEX "AuditLog_occurredAt_idx" ON "AuditLog"("occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_module_action_idx" ON "AuditLog"("module", "action");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
