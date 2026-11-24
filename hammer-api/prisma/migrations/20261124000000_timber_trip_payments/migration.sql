-- Cuenta con el proveedor de un viaje de madera: adelantos, abonos, otros abonos y restas.
-- 100% aditivo: tabla nueva, no toca datos existentes.
CREATE TABLE "TimberTripPayment" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimberTripPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TimberTripPayment_tripId_idx" ON "TimberTripPayment"("tripId");

ALTER TABLE "TimberTripPayment" ADD CONSTRAINT "TimberTripPayment_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "TimberTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
