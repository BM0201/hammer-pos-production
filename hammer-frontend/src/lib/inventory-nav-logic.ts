/**
 * prompt-inventario-inicio-fix.md Commit 1 (base) + prompt-inventario-
 * unificado.md Commit 1 (reescritura) — ÚNICA fuente de verdad para
 * grupos/subsecciones de la barra superior de Inventario. Pura, sin DOM:
 * qué grupo/subsección están activos según la ruta, los tonos, y el helper
 * que arma cada link de la barra conservando el alcance de sucursal.
 *
 * Reescritura (unificado): 4→5 grupos, Existencias y Calidad ahora SÍ
 * navegan a algo (antes el botón de grupo perdía el `?tab=` y el alcance);
 * "movements" (compartido por Entradas/Conteos/Kardex, causa real de la
 * subpestaña marcada mal) se separa en kardex/intakes/counts, una vista
 * por URL; Traslados y Reposición se montan DENTRO del layout (ya no
 * "external"/↗ — ver inventory-topbar.tsx y sus page.tsx).
 */

export type InventoryGroupKey = "home" | "products" | "stock" | "movements" | "quality";
export type InventoryTone = "neutral" | "danger" | "warning";

export type InventorySubsection = {
  key: string;
  label: string;
  /** Ruta "limpia" (sin query de alcance) — matchPath decide si la ruta actual es esta, matchTab (opcional) revisa además un ?tab= de la pantalla vieja. */
  path: string;
  tab?: string;
  /** Parámetros fijos adicionales que esta subsección siempre agrega (p.ej. Pendientes = Productos con un filtro de calidad ya aplicado) — la hacen una vista genuinamente distinta, no una pestaña repetida. */
  params?: Record<string, string>;
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
    // "ninguna: una sola página" — una subsección nominal para que
    // resolveActiveNav tenga adónde apuntar; la barra no dibuja fila 3
    // cuando subsections.length <= 1 (ver inventory-topbar.tsx).
    subsections: [{ key: "home", label: "Inicio", path: "/app/master/inventory" }],
  },
  {
    key: "products",
    label: "Productos",
    path: "/app/master/catalog-inventory",
    subsections: [
      { key: "list", label: "Lista", path: "/app/master/catalog-inventory", tab: "products" },
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
      { key: "by-branch", label: "Por sucursal", path: "/app/master/catalog-inventory", tab: "stock" },
      { key: "lookup", label: "Consultar", path: "/app/master/inventory-lookup" },
      { key: "counts", label: "Conteos", path: "/app/master/catalog-inventory", tab: "counts" },
      // Reposición y Traslados (abajo) son la MISMA pantalla
      // (/app/master/replenishment) — Reposición es su pestaña por
      // defecto (sin tab = "signals" dentro de esa pantalla).
      { key: "replenishment", label: "Reposición", path: "/app/master/replenishment" },
    ],
  },
  {
    key: "movements",
    label: "Movimientos",
    path: "/app/master/catalog-inventory",
    subsections: [
      { key: "kardex", label: "Kardex", path: "/app/master/catalog-inventory", tab: "kardex" },
      { key: "intakes", label: "Entradas", path: "/app/master/catalog-inventory", tab: "intakes" },
      // /app/master/transfers es solo un redirect permanente a
      // /app/master/replenishment?tab=transit (se fusionaron hace tiempo)
      // — apuntar directo evita perder el tab en el salto.
      { key: "transfers", label: "Traslados", path: "/app/master/replenishment", tab: "transit" },
    ],
  },
  {
    key: "quality",
    label: "Calidad",
    path: "/app/master/catalog-inventory",
    subsections: [
      // Distinta de Productos/Lista: mismo tab, pero con un filtro de
      // calidad ya aplicado — una vista genuinamente distinta, no la
      // misma pantalla con otro nombre.
      { key: "pending", label: "Pendientes", path: "/app/master/catalog-inventory", tab: "products", params: { filter: "NO_COST" } },
      { key: "duplicates", label: "Duplicados", path: "/app/master/catalog-inventory", tab: "duplicates" },
      { key: "import", label: "Importar / Exportar", path: "/app/master/catalog-inventory", tab: "import" },
      { key: "history", label: "Historial", path: "/app/master/catalog-inventory", tab: "audit" },
    ],
  },
];

/** Pestañas viejas que ya no existen como tal (de antes de separar Movimientos) — a qué subsección nueva caen. */
const LEGACY_TAB_REMAP: Record<string, string> = {
  movements: "kardex",
};

export type ActiveNav = { groupKey: InventoryGroupKey; subsectionKey: string } | null;

/**
 * Grupo y subsección activos según la ruta actual — incluidas las rutas
 * viejas (catalog-inventory?tab=X, tab=movements) y la ficha de producto
 * (que no tiene subsección propia: cae a "Productos/Lista", el lugar del
 * que viene).
 *
 * `extraParams` desambigua subsecciones que comparten path+tab pero se
 * distinguen por un parámetro fijo (Pendientes = Productos/Lista +
 * `filter=NO_COST`): entre las que matchean path+tab, gana la que exige
 * MÁS parámetros fijos y los tiene todos — "Lista" (sin exigencias) es el
 * fallback natural cuando ningún parámetro específico está presente.
 */
export function resolveActiveNav(pathname: string, tab: string | null, extraParams: Record<string, string> = {}): ActiveNav {
  if (pathname.startsWith("/app/master/catalog-inventory/products/")) {
    return { groupKey: "products", subsectionKey: "list" };
  }
  // Escanear productos (alta rápida) — sin subsección propia en la tabla
  // del doc; cae en "Lista", de donde se entra hoy ("Nuevo producto").
  if (pathname === "/app/master/catalog/products/quick-add") {
    return { groupKey: "products", subsectionKey: "list" };
  }

  const effectiveTab = tab !== null && LEGACY_TAB_REMAP[tab] ? LEGACY_TAB_REMAP[tab] : tab;

  const candidates: Array<{ group: InventoryGroup; sub: InventorySubsection }> = [];
  for (const group of INVENTORY_GROUPS) {
    for (const sub of group.subsections) {
      if (sub.path !== pathname) continue;
      if (sub.tab === undefined ? effectiveTab !== null : sub.tab !== effectiveTab) continue;
      const requiredParams = Object.entries(sub.params ?? {});
      const matchesParams = requiredParams.every(([key, value]) => extraParams[key] === value);
      if (matchesParams) candidates.push({ group, sub });
    }
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => Object.keys(b.sub.params ?? {}).length - Object.keys(a.sub.params ?? {}).length);
    return { groupKey: candidates[0].group.key, subsectionKey: candidates[0].sub.key };
  }

  // Mismo path, ningún tab definido coincide (ej. catalog-inventory?tab=pricing,
  // una pestaña vieja sin subsección nueva): cae a la primera subsección de
  // CUALQUIER grupo que use ese path, para no dejar la barra sin nada activo.
  for (const group of INVENTORY_GROUPS) {
    const fallback = group.subsections.find((sub) => sub.path === pathname);
    if (fallback) return { groupKey: group.key, subsectionKey: fallback.key };
  }
  return null;
}

/**
 * prompt-inventario-unificado.md Commit 1 — arma el link de CUALQUIER
 * botón/pestaña de la barra conservando SIEMPRE el alcance de sucursal
 * (`branch`), que antes se perdía al navegar por grupo (bug #1 del doc:
 * el botón de grupo solo usaba `.path`, sin tab ni alcance).
 */
export function buildInventoryHref(target: InventorySubsection, params: { branch?: string | null }): string {
  const qs = new URLSearchParams();
  if (params.branch) qs.set("branch", params.branch);
  if (target.tab) qs.set("tab", target.tab);
  if (target.params) {
    for (const [key, value] of Object.entries(target.params)) qs.set(key, value);
  }
  const query = qs.toString();
  return query ? `${target.path}?${query}` : target.path;
}

/** "rojo si hay negativos o traslados atrasados", "ámbar con los pendientes" — un solo helper, nada de bordes decorativos sin regla. */
export function groupTone(groupKey: InventoryGroupKey, counts: { negativeStock: number; staleTransfers: number; pendingQuality: number }): InventoryTone {
  if (groupKey === "stock" && (counts.negativeStock > 0 || counts.staleTransfers > 0)) return "danger";
  if (groupKey === "quality" && counts.pendingQuality > 0) return "warning";
  return "neutral";
}

export type NavSearchProduct = { id: string; sku: string; name: string; barcode?: string | null };
export type NavSearchResultGroup = { kind: "products" | "sections" | "actions"; items: Array<{ id: string; label: string; sublabel?: string; href: string }> };

const SECTION_SEARCH_ENTRIES: Array<{ keywords: string[]; label: string; href: string }> = [
  { keywords: ["conteo", "conteos"], label: "Conteos", href: "/app/master/catalog-inventory?tab=counts" },
  { keywords: ["duplicado", "duplicados"], label: "Duplicados", href: "/app/master/catalog-inventory?tab=duplicates" },
  { keywords: ["categoria", "categorías", "categorias"], label: "Categorías", href: "/app/master/catalog-inventory?tab=categories" },
  { keywords: ["codigo", "códigos", "codigos", "barra"], label: "Códigos de barra", href: "/app/master/catalog/barcodes" },
  { keywords: ["presentacion", "presentaciones", "fusion", "fusión"], label: "Presentaciones", href: "/app/master/inventory-fusion" },
  { keywords: ["stock", "existencia", "existencias"], label: "Stock por sucursal", href: "/app/master/catalog-inventory?tab=stock" },
  { keywords: ["consultar", "escaneo", "escanear"], label: "Consultar existencias", href: "/app/master/inventory-lookup" },
  { keywords: ["entrada", "entradas"], label: "Entradas", href: "/app/master/catalog-inventory?tab=intakes" },
  { keywords: ["kardex"], label: "Kardex", href: "/app/master/catalog-inventory?tab=kardex" },
  { keywords: ["traslado", "traslados"], label: "Traslados", href: "/app/master/replenishment?tab=transit" },
  { keywords: ["reposicion", "reposición"], label: "Reposición", href: "/app/master/replenishment" },
  { keywords: ["pendiente", "pendientes"], label: "Pendientes", href: "/app/master/catalog-inventory?tab=products&filter=NO_COST" },
  { keywords: ["importar", "exportar", "excel"], label: "Importar / Exportar", href: "/app/master/catalog-inventory?tab=import" },
  { keywords: ["historial", "auditoria", "auditoría"], label: "Historial", href: "/app/master/catalog-inventory?tab=audit" },
];

const ACTION_SEARCH_ENTRIES: Array<{ keywords: string[]; label: string; href: string }> = [
  { keywords: ["nueva entrada", "entrada", "sumar"], label: "Nueva entrada", href: "/app/master/catalog-inventory?tab=intakes" },
  { keywords: ["nuevo producto", "producto", "alta"], label: "Nuevo producto", href: "/app/master/catalog-inventory?tab=products" },
  { keywords: ["nuevo conteo", "conteo"], label: "Nuevo conteo", href: "/app/master/catalog-inventory?tab=counts" },
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
 * Buscador (paleta de comandos) — productos (código exacto primero),
 * secciones y acciones, en ese orden. Pura: los productos ya vienen
 * resueltos (la llamada a /api/master/inventory/products?q= la hace el
 * componente).
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
