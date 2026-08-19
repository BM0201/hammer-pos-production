import { redirect } from "next/navigation";
import type { Route } from "next";

export default function MasterProductsPage() {
  redirect("/app/master/catalog-inventory?tab=products" as Route);
}
