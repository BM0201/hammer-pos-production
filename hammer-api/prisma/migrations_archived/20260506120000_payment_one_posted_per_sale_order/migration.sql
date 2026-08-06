-- Enforce one posted payment per sale order (defense in depth for race conditions)
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_one_posted_per_sale_order"
ON "Payment" ("saleOrderId")
WHERE "status" = 'POSTED';
