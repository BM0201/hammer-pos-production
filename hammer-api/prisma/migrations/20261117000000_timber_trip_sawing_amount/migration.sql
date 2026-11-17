-- Madera: el aserrado va aparte de la compra de la madera (antes iba sumado en
-- woodTripTotalCost o en otherExpensesAmount). 100% aditivo, default 0: los
-- viajes existentes no cambian de costo.

-- AlterTable
ALTER TABLE "TimberTrip" ADD COLUMN     "sawingAmount" DECIMAL(65,30) NOT NULL DEFAULT 0;
