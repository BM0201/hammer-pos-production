"use client";

import { use } from "react";
import { SaleDetail } from "@/components/sales-management/sale-detail";

export default function MasterSaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <section className="space-y-6 animate-fade-in-up">
      <SaleDetail saleId={id} />
    </section>
  );
}
