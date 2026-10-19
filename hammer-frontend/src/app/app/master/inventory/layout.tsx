import { Suspense } from "react";
import { InventoryLocalNav } from "@/components/inventory/inventory-local-nav";

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 p-4 md:flex-row">
      <Suspense fallback={null}>
        <InventoryLocalNav />
      </Suspense>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
