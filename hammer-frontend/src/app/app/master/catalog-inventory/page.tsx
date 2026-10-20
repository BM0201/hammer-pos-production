"use client";

import { Suspense } from "react";
import { InventoryTopbar } from "@/components/inventory/inventory-topbar";
import { CatalogInventoryAdmin } from "@/components/catalog-inventory/catalog-inventory-admin";

export default function CatalogInventoryPage() {
  return (
    <>
      <Suspense fallback={null}>
        <InventoryTopbar />
      </Suspense>
      <CatalogInventoryAdmin />
    </>
  );
}
