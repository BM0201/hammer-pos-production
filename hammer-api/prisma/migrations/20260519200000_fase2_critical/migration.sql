-- CreateEnum
CREATE TYPE "DocumentMode" AS ENUM ('DELIVERY_ORDER_ONLY', 'MANUAL_INVOICE_REQUIRED', 'MANUAL_INVOICE_REGISTERED');

-- CreateEnum
CREATE TYPE "ManualInvoiceStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'REGISTERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrinterMode" AS ENUM ('BROWSER_PRINT', 'QZ_TRAY', 'NETWORK_ESCPOS', 'PDF_ONLY');

-- CreateEnum
CREATE TYPE "PaperWidth" AS ENUM ('W58MM', 'W80MM', 'A4');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('DELIVERY_ORDER', 'PURCHASE_TICKET', 'PAYMENT_RECEIPT', 'PRODUCTION_ORDER');

-- AlterTable
ALTER TABLE "SaleOrder" ADD COLUMN     "deliveryOrderIssuedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryOrderNumber" TEXT,
ADD COLUMN     "deliveryOrderPrintedAt" TIMESTAMP(3),
ADD COLUMN     "documentMode" "DocumentMode" NOT NULL DEFAULT 'DELIVERY_ORDER_ONLY',
ADD COLUMN     "manualInvoiceCustomerName" TEXT,
ADD COLUMN     "manualInvoiceCustomerRuc" TEXT,
ADD COLUMN     "manualInvoiceDate" TIMESTAMP(3),
ADD COLUMN     "manualInvoiceNotes" TEXT,
ADD COLUMN     "manualInvoiceNumber" TEXT,
ADD COLUMN     "manualInvoiceRegisteredAt" TIMESTAMP(3),
ADD COLUMN     "manualInvoiceRegisteredById" TEXT,
ADD COLUMN     "manualInvoiceSeries" TEXT,
ADD COLUMN     "manualInvoiceStatus" "ManualInvoiceStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "requiresManualInvoice" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "UserPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintSettings" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "printerName" TEXT,
    "printerMode" "PrinterMode" NOT NULL DEFAULT 'BROWSER_PRINT',
    "paperWidth" "PaperWidth" NOT NULL DEFAULT 'W80MM',
    "fontSize" INTEGER NOT NULL DEFAULT 12,
    "logoUrl" TEXT,
    "footerText" TEXT,
    "autoPrint" BOOLEAN NOT NULL DEFAULT false,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "cutPaper" BOOLEAN NOT NULL DEFAULT true,
    "openDrawer" BOOLEAN NOT NULL DEFAULT false,
    "showQr" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "description" TEXT,
    "templateContent" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPrintLog" (
    "id" TEXT NOT NULL,
    "saleOrderId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "printedById" TEXT NOT NULL,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isReprint" BOOLEAN NOT NULL DEFAULT false,
    "reprintReason" TEXT,

    CONSTRAINT "DocumentPrintLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserPermission_userId_idx" ON "UserPermission"("userId");

-- CreateIndex
CREATE INDEX "UserPermission_permission_idx" ON "UserPermission"("permission");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_userId_permission_key" ON "UserPermission"("userId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "PrintSettings_branchId_key" ON "PrintSettings"("branchId");

-- CreateIndex
CREATE INDEX "DocumentTemplate_documentType_isActive_idx" ON "DocumentTemplate"("documentType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_name_key" ON "DocumentTemplate"("name");

-- CreateIndex
CREATE INDEX "DocumentPrintLog_saleOrderId_idx" ON "DocumentPrintLog"("saleOrderId");

-- CreateIndex
CREATE INDEX "DocumentPrintLog_printedById_printedAt_idx" ON "DocumentPrintLog"("printedById", "printedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SaleOrder_deliveryOrderNumber_key" ON "SaleOrder"("deliveryOrderNumber");

-- CreateIndex
CREATE INDEX "SaleOrder_deliveryOrderNumber_idx" ON "SaleOrder"("deliveryOrderNumber");

-- CreateIndex
CREATE INDEX "SaleOrder_manualInvoiceSeries_manualInvoiceNumber_idx" ON "SaleOrder"("manualInvoiceSeries", "manualInvoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SaleOrder_branchId_manualInvoiceSeries_manualInvoiceNumber_key" ON "SaleOrder"("branchId", "manualInvoiceSeries", "manualInvoiceNumber");

-- AddForeignKey
ALTER TABLE "SaleOrder" ADD CONSTRAINT "SaleOrder_manualInvoiceRegisteredById_fkey" FOREIGN KEY ("manualInvoiceRegisteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintSettings" ADD CONSTRAINT "PrintSettings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPrintLog" ADD CONSTRAINT "DocumentPrintLog_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "SaleOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPrintLog" ADD CONSTRAINT "DocumentPrintLog_printedById_fkey" FOREIGN KEY ("printedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

