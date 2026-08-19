-- Enforce one posted payment per sale order.
-- Prisma schema cannot represent this PostgreSQL partial unique index directly.
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_one_posted_per_sale_order"
ON "Payment" ("saleOrderId")
WHERE "status" = 'POSTED';
