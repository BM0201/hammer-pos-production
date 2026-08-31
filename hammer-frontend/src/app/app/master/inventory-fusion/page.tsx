"use client";

import { InventoryFusionManager } from "@/components/inventory/inventory-fusion-manager";

/**
 * "Ese apartado de Fusiones, es para poner el precio, no es otra pestaña
 * para crear" — la pestaña "Fusiones" dentro de Catálogo e Inventario
 * (FusionPricingPanel) hace solo eso: poner el costo global de cada
 * presentación. Crear fusiones nuevas, editar presentaciones/factores,
 * desfusionar o reparar sigue viviendo acá, en su propia pantalla —
 * enlazada desde el panel de precios, no un redirect.
 */
export default function InventoryFusionPage() {
  return (
    <section className="space-y-6 animate-fade-in-up">
      <InventoryFusionManager />
    </section>
  );
}
