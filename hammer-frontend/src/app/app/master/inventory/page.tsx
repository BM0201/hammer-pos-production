import { redirect } from "next/navigation";
import type { Route } from "next";

export default function MasterInventoryPage() {
  redirect("/app/master/catalog-inventory?tab=stock" as Route);
}
