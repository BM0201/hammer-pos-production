import { Suspense } from "react";
import { InventoryTopbar } from "@/components/inventory/inventory-topbar";

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <Suspense fallback={null}>
        <InventoryTopbar />
      </Suspense>
      <div className="min-w-0 flex-1 p-4">{children}</div>
    </div>
  );
}
