import { Suspense } from "react";
import { InventoryHome } from "@/components/inventory/inventory-home";

export default function MasterInventoryPage() {
  return (
    <Suspense fallback={null}>
      <InventoryHome />
    </Suspense>
  );
}
