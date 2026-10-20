"use client";

import { use, Suspense } from "react";
import { InventoryTopbar } from "@/components/inventory/inventory-topbar";
import { Product360 } from "@/components/catalog-inventory/product-360";

export default function Product360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <>
      <Suspense fallback={null}>
        <InventoryTopbar />
      </Suspense>
      <Product360 productId={id} />
    </>
  );
}
