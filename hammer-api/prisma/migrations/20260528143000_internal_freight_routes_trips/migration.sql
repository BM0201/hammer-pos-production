-- CreateTable
CREATE TABLE "InternalFreightRoute" (
    "id" TEXT NOT NULL,
    "originBranchId" TEXT NOT NULL,
    "destinationBranchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roundTripKm" DECIMAL(65,30) NOT NULL,
    "defaultAllocationMethod" TEXT NOT NULL DEFAULT 'BY_VALUE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalFreightRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Truck" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plate" TEXT,
    "fuelEfficiencyKmPerGallon" DECIMAL(65,30),
    "maintenanceCostPerKm" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Truck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalFreightTrip" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "transferId" TEXT,
    "truckId" TEXT,
    "tripDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fuelPricePerGallon" DECIMAL(65,30) NOT NULL,
    "fuelCost" DECIMAL(65,30) NOT NULL,
    "maintenanceCost" DECIMAL(65,30) NOT NULL,
    "driverCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "helperCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "otherCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalTripCost" DECIMAL(65,30) NOT NULL,
    "allocationMethod" TEXT NOT NULL DEFAULT 'BY_VALUE',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalFreightTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalFreightTripLine" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "transferLineId" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL,
    "lineValue" DECIMAL(65,30) NOT NULL,
    "allocatedFreight" DECIMAL(65,30) NOT NULL,
    "allocatedFreightPerUnit" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalFreightTripLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InternalFreightRoute_originBranchId_destinationBranchId_isActive_idx" ON "InternalFreightRoute"("originBranchId", "destinationBranchId", "isActive");

-- CreateIndex
CREATE INDEX "InternalFreightTrip_routeId_status_idx" ON "InternalFreightTrip"("routeId", "status");

-- CreateIndex
CREATE INDEX "InternalFreightTrip_transferId_idx" ON "InternalFreightTrip"("transferId");

-- CreateIndex
CREATE INDEX "InternalFreightTripLine_tripId_idx" ON "InternalFreightTripLine"("tripId");

-- CreateIndex
CREATE INDEX "InternalFreightTripLine_productId_idx" ON "InternalFreightTripLine"("productId");

-- CreateIndex
CREATE INDEX "InternalFreightTripLine_transferLineId_idx" ON "InternalFreightTripLine"("transferLineId");

-- AddForeignKey
ALTER TABLE "InternalFreightRoute" ADD CONSTRAINT "InternalFreightRoute_originBranchId_fkey" FOREIGN KEY ("originBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalFreightRoute" ADD CONSTRAINT "InternalFreightRoute_destinationBranchId_fkey" FOREIGN KEY ("destinationBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalFreightTrip" ADD CONSTRAINT "InternalFreightTrip_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "InternalFreightRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalFreightTrip" ADD CONSTRAINT "InternalFreightTrip_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalFreightTrip" ADD CONSTRAINT "InternalFreightTrip_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalFreightTripLine" ADD CONSTRAINT "InternalFreightTripLine_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "InternalFreightTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalFreightTripLine" ADD CONSTRAINT "InternalFreightTripLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalFreightTripLine" ADD CONSTRAINT "InternalFreightTripLine_transferLineId_fkey" FOREIGN KEY ("transferLineId") REFERENCES "TransferLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
