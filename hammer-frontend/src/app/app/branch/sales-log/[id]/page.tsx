"use client";

import { use } from "react";
import { SaleDetail } from "@/components/sales-management/sale-detail";

/**
 * Detalle de una venta dentro de la bitácora de sucursal. Reutiliza el
 * componente `SaleDetail` apuntándolo al endpoint branch (`/api/branch/sales-log`),
 * que valida que la venta pertenezca a la sucursal del usuario.
 */
export default function BranchSaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <section className="space-y-6 animate-fade-in-up">
      <SaleDetail saleId={id} endpoint="/api/branch/sales-log" />
    </section>
  );
}
