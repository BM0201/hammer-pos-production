/**
 * prompt-inventario-inicio-fix.md Commit 1 — ÚNICA fuente de verdad para
 * grupos/subsecciones de la barra superior de Inventario (antes repartido
 * entre inventory-nav.ts y el estado interno de catalog-inventory-admin.tsx).
 * Pura, sin DOM: qué grupo/subsección están activos según la ruta, y los
 * colores/tonos de los grupos — todo testeable sin montar nada.
 */

export type InventoryGroupKey = "home" | "catalog" | "stock" | "quality";
export type InventoryTone = "neutral" | "danger" | "warning";

export type InventorySubsection = {
  key: string;
  label: string;
  /** Ruta "limpia" (sin query de alcance) — matchPath decide si la ruta actual es esta, matchTab (opcional) revisa además un ?tab= de la pantalla vieja. */
  path: string;
  tab?: string;
  /** Traslados y Reposición: abren su propio módulo, sin la barra — se marcan con ↗ y nunca quedan "activas" dentro de Inventario. */
  external?: boolean;
};

export type InventoryGroup = {
  key: InventoryGroupKey;
  label: string;
  path: string;
  subsections: InventorySubsection[];
};

export const INVENTORY_GROUPS: InventoryGroup[] = [
  {
    key: "home",
    label: "Inicio",
    path: "/app/master/inventory",
    subsections: [
      { key: "summary", label: "Resumen", path: "/app/master/inventory" },
      { key: "attention", label: "Para atender", path: "/app/master/inventory", tab: "attention" },
      { key: "analysis", label: "Análisis", path: "/app/master/inventory", tab: "analysis" },
    ],
  },
  {
    key: "catalog",
    label: "Catálogo",
    path: "/app/master/catalog-inventory",
    subsections: [
      { key: "products", label: "Productos", path: "/app/master/catalog-inventory", tab: "products" },
      { key: "categories", label: "Categorías", path: "/app/master/catalog-inventory", tab: "categories" },
      { key: "barcodes", label: "Códigos de barra", path: "/app/master/catalog/barcodes" },
      { key: "presentations", label: "Presentaciones", path: "/app/master/inventory-fusion" },
    ],
  },
  {
    key: "stock",
    label: "Existencias",
    path: "/app/master/catalog-inventory",
    subsections: [
      { key: "stock", label: "Stock por sucursal", path: "/app/master/catalog-inventory", tab: "stock" },
      { key: "intake", label: "Entradas", path: "/app/master/catalog-inventory", tab: "movements" },
      { key: "counts", label: "Conteos", path: "/app/master/catalog-inventory", tab: "movements" },
      { key: "kardex", label: "Kardex", path: "/app/master/catalog-inventory", tab: "movements" },
      { key: "transfers", label: "Traslados", path: "/app/master/transfers", external: true },
      { key: "replenishment", label: "Reposición", path: "/app/master/replenishment", external: true },
    ],
  },
  {
    key: "quality",
    label: "Calidad de datos",
    path: "/app/master/catalog-inventory",
    subsections: [
      { key: "pending", label: "Pendientes", path: "/app/master/catalog-inventory", tab: "products" },
      { key: "duplicates", label: "Duplicados", path: "/app/master/catalog-inventory", tab: "duplicates" },
      { key: "import", label: "Importar / Exportar", path: "/app/master/catalog-inventory", tab: "import" },
      { key: "history", label: "Historial", path: "/app/master/catalog-inventory", tab: "audit" },
    ],
  },
];

export type ActiveNav = { groupKey: InventoryGroupKey; subsectionKey: string } | null;

/**
 * Grupo y subsección activos según la ruta actual — incluidas las rutas
 * viejas (catalog-inventory?tab=X) y la ficha de producto (que no tiene
 * subsección propia: cae a "Catálogo/Productos", el lugar del que viene).
 */
export function resolveActiveNav(pathname: string, tab: string | null): ActiveNav {
  if (pathname.startsWith("/app/master/catalog-inventory/products/")) {
    return { groupKey: "catalog", subsectionKey: "products" };
  }
  // Escanear productos (alta rápida) — sin subsección propia en la tabla
  // del doc; cae en "Productos", de donde se entra hoy ("Nuevo producto").
  if (pathname === "/app/master/catalog/products/quick-add") {
    return { groupKey: "catalog", subsectionKey: "products" };
  }
  for (const group of INVENTORY_GROUPS) {
    for (const sub of group.subsections) {
      if (sub.external) continue;
      if (sub.path !== pathname) continue;
      if (sub.tab === undefined) {
        if (tab === null) return { groupKey: group.key, subsectionKey: sub.key };
        continue;
      }
      if (sub.tab === tab) return { groupKey: group.key, subsectionKey: sub.key };
    }
  }
  // Mismo path, ningún tab definido coincide (ej. catalog-inventory?tab=pricing,
  // una pestaña vieja sin subsección nueva): cae a la primera subsección de
  // CUALQUIER grupo que use ese path, para no dejar la barra sin nada activo.
  for (const group of INVENTORY_GROUPS) {
    const fallback = group.subsections.find((sub) => !sub.external && sub.path === pathname);
    if (fallback) return { groupKey: group.key, subsectionKey: fallback.key };
  }
  return null;
}

/** "rojo si hay negativos o traslados atrasados", "ámbar con los pendientes" — un solo helper, nada de bordes decorativos sin regla (Commit 2 #3 aplica el mismo criterio a los KPIs). */
export function groupTone(groupKey: InventoryGroupKey, counts: { negativeStock: number; staleTransfers: number; pendingQuality: number }): InventoryTone {
  if (groupKey === "stock" && (counts.negativeStock > 0 || counts.staleTransfers > 0)) return "danger";
  if (groupKey === "quality" && counts.pendingQuality > 0) return "warning";
  return "neutral";
}

export type NavSearchProduct = { id: string; sku: string; name: string; barcode?: string | null };
export type NavSearchResultGroup = { kind: "products" | "sections" | "actions"; items: Array<{ id: string; label: string; sublabel?: string; href: string }> };

const SECTION_SEARCH_ENTRIES: Array<{ keywords: string[]; label: string; href: string }> = [
  { keywords: ["conteo", "conteos"], label: "Conteos", href: "/app/master/catalog-inventory?tab=movements" },
  { keywords: ["duplicado", "duplicados"], label: "Duplicados", href: "/app/master/catalog-inventory?tab=duplicates" },
  { keywords: ["categoria", "categorías", "categorias"], label: "Categorías", href: "/app/master/catalog-inventory?tab=categories" },
  { keywords: ["codigo", "códigos", "codigos", "barra"], label: "Códigos de barra", href: "/app/master/catalog/barcodes" },
  { keywords: ["presentacion", "presentaciones", "fusion", "fusión"], label: "Presentaciones", href: "/app/master/inventory-fusion" },
  { keywords: ["stock", "existencia", "existencias"], label: "Stock por sucursal", href: "/app/master/catalog-inventory?tab=stock" },
  { keywords: ["entrada", "entradas"], label: "Entradas", href: "/app/master/catalog-inventory?tab=movements" },
  { keywords: ["kardex"], label: "Kardex", href: "/app/master/catalog-inventory?tab=movements" },
  { keywords: ["pendiente", "pendientes"], label: "Pendientes", href: "/app/master/catalog-inventory?tab=products" },
  { keywords: ["importar", "exportar", "excel"], label: "Importar / Exportar", href: "/app/master/catalog-inventory?tab=import" },
  { keywords: ["historial", "auditoria", "auditoría"], label: "Historial", href: "/app/master/catalog-inventory?tab=audit" },
];

const ACTION_SEARCH_ENTRIES: Array<{ keywords: string[]; label: string; href: string }> = [
  { keywords: ["nueva entrada", "entrada", "sumar"], label: "Nueva entrada", href: "/app/master/catalog-inventory?tab=movements" },
  { keywords: ["nuevo producto", "producto", "alta"], label: "Nuevo producto", href: "/app/master/catalog-inventory?tab=products" },
  { keywords: ["nuevo conteo", "conteo"], label: "Nuevo conteo", href: "/app/master/catalog-inventory?tab=movements" },
  { keywords: ["escanear", "scan", "codigos", "códigos"], label: "Escanear códigos", href: "/app/master/catalog/barcodes" },
];

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Buscador (Commit 1.4) — productos (código exacto primero), secciones y
 * acciones, en ese orden. Pura: los productos ya vienen resueltos (la
 * llamada a /api/master/inventory/products?q= la hace el componente).
 */
export function buildNavSearchResults(query: string, products: NavSearchProduct[]): NavSearchResultGroup[] {
  const q = normalize(query);
  if (!q) return [];

  const exactCode = products.find((p) => normalize(p.sku) === q || (p.barcode && normalize(p.barcode) === q));
  const productItems = (exactCode ? [exactCode, ...products.filter((p) => p.id !== exactCode.id)] : products)
    .slice(0, 8)
    .map((p) => ({ id: p.id, label: p.name, sublabel: p.sku, href: `/app/master/catalog-inventory/products/${p.id}` }));

  const sectionItems = SECTION_SEARCH_ENTRIES
    .filter((entry) => entry.keywords.some((k) => normalize(k).includes(q) || q.includes(normalize(k))))
    .map((entry) => ({ id: entry.href, label: entry.label, href: entry.href }));

  const actionItems = ACTION_SEARCH_ENTRIES
    .filter((entry) => entry.keywords.some((k) => normalize(k).includes(q) || q.includes(normalize(k))))
    .map((entry) => ({ id: `action:${entry.href}`, label: entry.label, href: entry.href }));

  const groups: NavSearchResultGroup[] = [];
  if (productItems.length > 0) groups.push({ kind: "products", items: productItems });
  if (sectionItems.length > 0) groups.push({ kind: "sections", items: sectionItems });
  if (actionItems.length > 0) groups.push({ kind: "actions", items: actionItems });
  return groups;
}

/** "el atajo Ctrl+K y / no se dispara mientras se escribe en un input" (Commit 1 test). */
export function shouldTriggerSearchShortcut(key: string, ctrlOrMeta: boolean, activeElementTag: string | null): boolean {
  const isTypingTarget = activeElementTag === "INPUT" || activeElementTag === "TEXTAREA" || activeElementTag === "SELECT";
  if (isTypingTarget) return false;
  if (key === "k" && ctrlOrMeta) return true;
  if (key === "/" && !ctrlOrMeta) return true;
  return false;
}
