"use client";

import { Suspense } from "react";
import { InventoryTopbar } from "@/components/inventory/inventory-topbar";
import { BarcodeManagerPage } from "@/components/catalog-inventory/barcode-manager/barcode-manager-page";

export default function BarcodesPage() {
  return (
    <>
      <Suspense fallback={null}>
        <InventoryTopbar />
      </Suspense>
      <BarcodeManagerPage />
    </>
  );
}
