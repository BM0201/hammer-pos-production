// Búsqueda de productos — versión cliente (sin Prisma) del módulo
// compartido hammer-api/src/modules/catalog/product-search.ts. Se porta en
// vez de importar directamente porque hammer-frontend y hammer-api son
// paquetes npm separados sin workspace compartido. Mantener el mismo
// criterio en ambos lados: tokenizar + exigir todos los tokens + ranking
// simple + agrupar por primera palabra del nombre.

/**
 * Parte la búsqueda en palabras: recorta espacios, separa por espacios en
 * blanco, descarta vacíos, normaliza a mayúsculas. "LIJA METAL" → ["LIJA", "METAL"].
 */
export function tokenize(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((token) => token.toUpperCase())
    .filter((token) => token.length > 0);
}

type SearchableItem = {
  name: string;
  sku: string;
  barcode?: string | null;
  categoryName?: string | null;
};

/** Todos los tokens deben aparecer en al menos uno de los campos buscables. */
export function matchesAllTokens(item: SearchableItem, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const name = item.name.toUpperCase();
  const sku = item.sku.toUpperCase();
  const barcode = (item.barcode ?? "").toUpperCase();
  const categoryName = (item.categoryName ?? "").toUpperCase();
  return tokens.every((token) => name.includes(token) || sku.includes(token) || barcode.includes(token) || categoryName.includes(token));
}

/**
 * Mismo ranking que el módulo del backend: empieza-con > contiene-frase >
 * todos-los-tokens-en-el-nombre > matchea-por-sku > resto (categoría/otros).
 */
export function rankProductMatches<T extends SearchableItem>(products: T[], query: string): T[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return products;

  const queryUpper = query.trim().toUpperCase();

  function rankOf(product: T): number {
    const nameUpper = product.name.toUpperCase();
    if (nameUpper.startsWith(queryUpper)) return 1;
    if (nameUpper.includes(queryUpper)) return 2;
    if (tokens.every((token) => nameUpper.includes(token))) return 3;
    const skuUpper = product.sku.toUpperCase();
    if (tokens.every((token) => skuUpper.includes(token))) return 4;
    return 5;
  }

  return products
    .map((product, index) => ({ product, index, rank: rankOf(product) }))
    .sort((a, b) => a.rank - b.rank || a.product.name.localeCompare(b.product.name) || a.index - b.index)
    .map((entry) => entry.product);
}

export type FamilyGroup<T> = {
  family: string;
  categoryName: string | null;
  items: T[];
};

const OTHER_MATCHES_FAMILY = "Otras coincidencias";

function firstWordOf(name: string): string {
  const trimmed = name.trim();
  const spaceIndex = trimmed.search(/\s/);
  return spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
}

function toTitleCase(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Agrupa por la primera palabra del nombre. Asume `products` ya viene
 * ordenado por relevancia (rankProductMatches): la familia del primer
 * producto es la dominante — todo lo que no la comparte (típicamente
 * porque solo matcheó por categoría) va a "Otras coincidencias" al final.
 */
export function groupProductsByFamily<T extends { name: string; categoryName?: string | null }>(
  products: T[],
): FamilyGroup<T>[] {
  if (products.length === 0) return [];

  const dominantFamilyKey = firstWordOf(products[0].name).toUpperCase();
  const dominantGroup: FamilyGroup<T> = {
    family: toTitleCase(firstWordOf(products[0].name)),
    categoryName: products[0].categoryName ?? null,
    items: [],
  };
  const otherMatches: T[] = [];

  for (const product of products) {
    if (firstWordOf(product.name).toUpperCase() === dominantFamilyKey) {
      dominantGroup.items.push(product);
    } else {
      otherMatches.push(product);
    }
  }

  const groups: FamilyGroup<T>[] = [dominantGroup];
  if (otherMatches.length > 0) {
    groups.push({ family: OTHER_MATCHES_FAMILY, categoryName: null, items: otherMatches });
  }
  return groups;
}
