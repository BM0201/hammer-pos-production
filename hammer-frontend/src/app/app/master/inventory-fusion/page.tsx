import { redirect } from "next/navigation";

/**
 * Compatibilidad: "Fusión de Inventario" se unificó en "Catálogo e
 * Inventario" (pestaña Fusiones) — el costo de un miembro derivado
 * depende de cómo está armada su fusión, así que ahora viven en el mismo
 * módulo en vez de en pantallas separadas. Esta ruta queda como redirect
 * permanente para no romper enlaces guardados.
 */
export default function InventoryFusionRedirectPage() {
  redirect("/app/master/catalog-inventory?tab=fusion");
}
