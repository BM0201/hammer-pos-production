-- Precio con tarjeta: lo que se suma a la orden cuando se paga con tarjeta (sin el 6% de descuento de contado).
-- 100% aditivo: columna nueva con default 0, no toca datos existentes.
ALTER TABLE "SaleOrder" ADD COLUMN "cardPriceAmount" DECIMAL(65,30) NOT NULL DEFAULT 0;
