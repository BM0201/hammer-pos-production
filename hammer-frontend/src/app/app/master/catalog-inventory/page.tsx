"use client";

import { use } from "react";
import { Product360 } from "@/components/catalog-inventory/product-360";

export default function Product360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Product360 productId={id} />;
}
