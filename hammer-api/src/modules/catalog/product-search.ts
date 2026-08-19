import { Prisma } from "@prisma/client";

/**
 * Búsqueda de productos — una sola fuente de verdad.
 *
 * Reemplaza las tres implementaciones casi idénticas que existían en
 * catalog/service.ts, catalog-inventory/service.ts y production/service.ts:
 * todas trataban la frase completa como un substring literal (buscar
 * "LIJA METAL" no encontraba "LIJA 3M #150 METAL" porque el texto pegado
 * no existe, aunque ambas palabras sí). Acá se tokeniza y se exige que
 * cada palabra aparezca en algún campo — sin motor externo ni fuzzy-match.
 */

/** Campos que los distintos consumidores pueden combinar en la búsqueda. */
export type SearchableField = "sku" | "name" | "barcode" | "code" | "category.name" | "category.code";

/**
 * Parte la búsqueda en palabras: recorta espacios, separa por espacios en
 * blanco, descarta vacíos, normaliza a mayúsculas para comparar sin
 * distinguir may/min. "LIJA METAL" → ["LIJA", "METAL"].
 */
export function tokenize(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((token) => token.toUpperCase())
    .filter((token) => token.length > 0);
}

function fieldContainsClause(field: SearchableField, token: string): Record<string, unknown> {
  const dotIndex = field.indexOf(".");
  if (dotIndex === -1) {
    return { [field]: { contains: token, mode: "insensitive" } };
  }
  const relation = field.slice(0, dotIndex);
  const subField = field.slice(dotIndex + 1);
  return { [relation]: { [subField]: { contains: token, mode: "insensitive" } } };
}

/**
 * Arma un where de Prisma donde CADA token debe aparecer en AL MENOS UNO
 * de los `fields` indicados (los tokens pueden matchear en campos
 * distintos entre sí). `fields` es parametrizable porque no todos los
 * consumidores buscan por lo mismo (producción busca por `code`, no por
 * `barcode`) — la única parte compartida es tokenizar + combinar.
 *
 * Tipado genérico porque este mismo builder se reutiliza contra distintos
 * modelos de Prisma (Product, ProductionRecipe) que no comparten un
 * WhereInput común pero sí la misma forma estructural AND/OR/contains.
 */
export function buildProductSearchWhere<TWhere = Prisma.ProductWhereInput>(
  query: string,
  fields: SearchableField[],
): TWhere {
  const tokens = tokenize(query);
  if (tokens.length === 0) return {} as TWhere;

  return {
    AND: tokens.map((token) => ({
      OR: fields.map((field) => fieldContainsClause(field, token)),
    })),
  } as TWhere;
}

// Los productos "crudos" de Prisma traen `category: {name}` anidado; los
// mapeados con inventario de sucursal (mapSingleProductWithBranchInventory,
// el camino que usa el POS) lo aplanan a `categoryName`. Se acepta cualquiera
// de las dos formas para no depender de cuál consumidor llama.
type CategoryLike = { category?: { name: string } | null; categoryName?: string | null };

function resolveCategoryName(item: CategoryLike): string | null {
  return item.category?.name ?? item.categoryName ?? null;
}

type RankableProduct = CategoryLike & {
  name: string;
  sku: string;
};

/**
 * Ranking simple calculado en memoria después de traer los resultados (no
 * en SQL, para no complicar la consulta). Generaliza el criterio que ya
 * existía en el catálogo offline del POS (priorizar "empieza con") en vez
 * de reinventarlo.
 *
 * 1. El nombre empieza con la búsqueda completa.
 * 2. El nombre contiene la búsqueda completa como frase.
 * 3. Todos los tokens aparecen en el nombre (en cualquier orden/posición).
 * 4. El SKU matchea.
 * 5. Matchea solo por categoría o campos secundarios.
 * Dentro de cada grupo, orden alfabético como desempate.
 */
export function rankProductMatches<T extends RankableProduct>(products: T[], query: string): T[] {
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

type FamilyGroupable = CategoryLike & {
  name: string;
};

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
 * Agrupa por la primera palabra del nombre (ej. "Ladrillo", "Lija" — el
 * patrón real de los productos: tipo genérico primero, detalles después).
 *
 * Asume `products` ya viene ordenado por relevancia (ver rankProductMatches):
 * la familia del primer producto es "la familia dominante" — la que el
 * usuario efectivamente buscaba. Todo lo que matcheó pero no comparte esa
 * familia (típicamente porque solo matcheó por categoría) va a un grupo
 * aparte "Otras coincidencias" al final, en vez de quedar alfabéticamente
 * intercalado con los resultados relevantes.
 */
export function groupProductsByFamily<T extends FamilyGroupable>(products: T[]): FamilyGroup<T>[] {
  if (products.length === 0) return [];

  const dominantFamilyKey = firstWordOf(products[0].name).toUpperCase();
  const dominantGroup: FamilyGroup<T> = {
    family: toTitleCase(firstWordOf(products[0].name)),
    categoryName: resolveCategoryName(products[0]),
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
