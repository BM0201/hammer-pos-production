-- CreateTable
CREATE TABLE "BranchCategoryPricingPolicy" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "minMarginPercent" DECIMAL(65,30) NOT NULL DEFAULT 15,
    "targetMarginPercent" DECIMAL(65,30) NOT NULL DEFAULT 30,
    "minProfitAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "maxDiscountPercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "estimatedMonthlyUnits" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "estimatedMonthlySalesValue" DECIMAL(65,30),
    "monthlyExpenseAllocation" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "stockPolicy" TEXT NOT NULL DEFAULT 'NORMAL',
    "priceMode" TEXT NOT NULL DEFAULT 'CATEGORY',
    "roundingRule" TEXT NOT NULL DEFAULT 'NEAREST_1',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchCategoryPricingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BranchCategoryPricingPolicy_branchId_categoryId_key" ON "BranchCategoryPricingPolicy"("branchId", "categoryId");

-- CreateIndex
CREATE INDEX "BranchCategoryPricingPolicy_branchId_isActive_idx" ON "BranchCategoryPricingPolicy"("branchId", "isActive");

-- CreateIndex
CREATE INDEX "BranchCategoryPricingPolicy_categoryId_idx" ON "BranchCategoryPricingPolicy"("categoryId");

-- AddForeignKey
ALTER TABLE "BranchCategoryPricingPolicy" ADD CONSTRAINT "BranchCategoryPricingPolicy_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchCategoryPricingPolicy" ADD CONSTRAINT "BranchCategoryPricingPolicy_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
