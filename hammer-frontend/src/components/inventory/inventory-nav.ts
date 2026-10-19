import type { LucideIcon } from "lucide-react";
import {
  Home, Package, FolderTree, Barcode, Merge, Boxes, PackagePlus, ClipboardCheck,
  History, ArrowLeftRight, TrendingUp, AlertCircle, Copy, FileSpreadsheet, ScrollText,
} from "lucide-react";

/**
 * prompt-inventario-v3.md Fase 2.1 — navegación lateral de la sección
 * nueva de Inventario. Reemplaza las 12 pestañas de catalog-inventory-admin.tsx
 * por secciones, pero NO borra ninguna pantalla todavía (eso es Fase 7):
 * los ítems que todavía no tienen pantalla nueva (Productos, Categorías,
 * Conteos, Pendientes, Duplicados, Importar/Exportar, Historial) siguen
 * apuntando a la pestaña vieja correspondiente hasta que su fase los
 * reemplace — "no se pierde ninguna función que exista hoy". Entradas,
 * Conteos y Kardex comparten hoy el mismo destino (tab=movements, donde ya
 * viven Entrada de inventario + modo Conteo + Kardex juntos) porque esa
 * pantalla todavía no los separa — se desambigua en Fase 6/Fase 4.
 */
export type InventoryNavItem = { href: string; label: string; icon: LucideIcon; badgeKey?: "pendientes" };
export type InventoryNavSection = { title: string; items: InventoryNavItem[] };

export const INVENTORY_NAV_SECTIONS: InventoryNavSection[] = [
  {
    title: "",
    items: [{ href: "/app/master/inventory", label: "Inicio", icon: Home }],
  },
  {
    title: "Catálogo",
    items: [
      { href: "/app/master/catalog-inventory?tab=products", label: "Productos", icon: Package },
      { href: "/app/master/catalog-inventory?tab=categories", label: "Categorías", icon: FolderTree },
      { href: "/app/master/catalog/barcodes", label: "Códigos de barra", icon: Barcode },
      { href: "/app/master/inventory-fusion", label: "Presentaciones", icon: Merge },
    ],
  },
  {
    title: "Existencias",
    items: [
      { href: "/app/master/catalog-inventory?tab=stock", label: "Stock por sucursal", icon: Boxes },
      { href: "/app/master/catalog-inventory?tab=movements", label: "Entradas", icon: PackagePlus },
      { href: "/app/master/catalog-inventory?tab=movements", label: "Conteos", icon: ClipboardCheck },
      { href: "/app/master/catalog-inventory?tab=movements", label: "Kardex", icon: History },
      { href: "/app/master/transfers", label: "Traslados", icon: ArrowLeftRight },
      { href: "/app/master/replenishment", label: "Reposición", icon: TrendingUp },
    ],
  },
  {
    title: "Calidad de datos",
    items: [
      { href: "/app/master/catalog-inventory?tab=products", label: "Pendientes", icon: AlertCircle, badgeKey: "pendientes" },
      { href: "/app/master/catalog-inventory?tab=duplicates", label: "Duplicados", icon: Copy },
      { href: "/app/master/catalog-inventory?tab=import", label: "Importar / Exportar", icon: FileSpreadsheet },
      { href: "/app/master/catalog-inventory?tab=audit", label: "Historial", icon: ScrollText },
    ],
  },
];
