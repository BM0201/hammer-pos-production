-- Speeds up the POS catalog listing and product search.
-- Supports filtering by isActive and ordering/searching by name.
CREATE INDEX IF NOT EXISTS "Product_isActive_name_idx" ON "Product"("isActive", "name");

-- Trigram index to accelerate case-insensitive "contains" search on product name.
-- Guarded so the migration still succeeds if the pg_trgm extension cannot be created.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx" ON "Product" USING gin ("name" gin_trgm_ops);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm not available, skipping trigram index: %', SQLERRM;
  END;
END $$;
