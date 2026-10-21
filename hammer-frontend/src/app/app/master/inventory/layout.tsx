import { Suspense } from "react";
import { InventoryTopbar } from "@/components/inventory/inventory-topbar";

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <Suspense fallback={null}>
        <InventoryTopbar />
      </Suspense>
      {/* prompt-inventario-unificado.md bug #8 — este padding extra desalineaba
          el borde del contenido con el de la barra (que ya respeta el padding
          del <main> global, p-5 lg:p-8): el <main> de app-shell-router.tsx ya
          da el espacio correcto, no hace falta uno propio acá. */}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
