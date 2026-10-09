/**
 * prompt-codigos-y-duplicados.md Fase 4 — pantalla de posibles duplicados.
 * Pura, sin DB — mismo principio que decidePriceBandPath/isPriceStaleAgainstCost
 * en otros módulos: esto decide SI dos nombres parecen el mismo producto,
 * el service.ts que la rodea resuelve los datos reales y pega la consulta.
 *
 * "ante la duda, no asumir" aplica acá al revés que en la fusión misma: una
 * SUGERENCIA de duplicado que resulta ser dos productos distintos es
 * molesta pero inofensiva (un humano la descarta); el motor de fusión real
 * (product-merge-service.ts) es el que de verdad bloquea — acá alcanza con
 * ser razonable, no exhaustivo. El bloqueo real de "no fusionar por error"
 * sigue viviendo en mergeProductsTx, no acá.
 */

const COMBINING_DIACRITICAL_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/** Nombres de fracciones comunes en el rubro — español, sin pretender cubrir todo. */
const NAMED_FRACTIONS: Record<string, string> = {
  "MEDIA": "1/2",
  "UN CUARTO": "1/4",
  "UN TERCIO": "1/3",
  "TRES CUARTOS": "3/4",
  "DOS TERCIOS": "2/3",
};

/**
 * Normaliza un nombre de producto para comparar: sin acentos/mayúsculas,
 * espacios colapsados, Y unifica la forma de escribir pulgadas — `1/2"`,
 * `1/2 pulg`, `1/2 pulgadas`, `media pulgada` terminan todos en `1/2IN`.
 * Deliberadamente MODESTO: no intenta convertir unidades distintas entre sí
 * (cm a pulgadas, libras a kilos) ni cubrir cada forma posible de
 * escribirlo — solo las variantes reales de "lo mismo escrito distinto"
 * que este catálogo usa.
 */
export function normalizeForDuplicateMatch(name: string): string {
  let normalized = name
    .normalize("NFD")
    .replace(COMBINING_DIACRITICAL_MARKS, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

  // Nombres de fracciones → la fracción numérica, ANTES de tocar "pulgada".
  for (const [word, fraction] of Object.entries(NAMED_FRACTIONS)) {
    normalized = normalized.replace(new RegExp(`\\b${word}\\s+PULGADAS?\\b`, "g"), `${fraction} PULGADA`);
  }

  // `1/2"` / `1/2 PULG` / `1/2 PULGADA(S)` → `1/2IN` (sin espacio, para que
  // el tokenizador de abajo lo trate como una sola palabra comparable).
  normalized = normalized
    .replace(/(\d+\/\d+|\d+)\s*"/g, "$1IN")
    .replace(/(\d+\/\d+|\d+)\s*PULG(ADAS?)?\b/g, "$1IN");

  return normalized.replace(/\s+/g, " ").trim();
}

function tokenize(normalized: string): Set<string> {
  return new Set(normalized.split(" ").filter((t) => t.length > 0));
}

/**
 * Coeficiente de Dice sobre los conjuntos de tokens — 2|A∩B| / (|A|+|B|).
 * 1 = mismos tokens exactos (en cualquier orden), 0 = nada en común.
 */
export function diceCoefficient(a: string, b: string): number {
  const tokensA = tokenize(normalizeForDuplicateMatch(a));
  const tokensB = tokenize(normalizeForDuplicateMatch(b));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1;
  }
  return (2 * intersection) / (tokensA.size + tokensB.size);
}

export const DUPLICATE_SIMILARITY_THRESHOLD = 0.8;

export type DuplicateCandidateProduct = {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  unit: string;
  barcode: string | null;
  totalStock: number;
  createdAt: Date;
};

export type DuplicateCandidatePair = {
  productA: DuplicateCandidateProduct;
  productB: DuplicateCandidateProduct;
  similarity: number;
  suggestedPrimaryId: string;
};

/**
 * "Cuál de los dos parece el real" — heurística explicable, no un puntaje
 * oculto: el que tiene código de barras gana (más completo), después el
 * que tiene más stock (más movimiento real), después el más viejo (el
 * original, el duplicado suele ser el que se creó después por error).
 */
export function suggestPrimary(a: DuplicateCandidateProduct, b: DuplicateCandidateProduct): string {
  if (Boolean(a.barcode) !== Boolean(b.barcode)) return a.barcode ? a.id : b.id;
  if (a.totalStock !== b.totalStock) return a.totalStock > b.totalStock ? a.id : b.id;
  return a.createdAt.getTime() <= b.createdAt.getTime() ? a.id : b.id;
}

export type DismissedPairKey = string;

/** Clave canónica de un par (sin importar el orden) — para buscar/guardar descartes. */
export function dismissedPairKey(productAId: string, productBId: string): DismissedPairKey {
  return [productAId, productBId].sort().join(":");
}

/**
 * Candidatos a duplicado: compara DENTRO de cada bloque (misma categoría +
 * misma unidad — comparar entre categorías distintas no tiene sentido y
 * multiplicaría el costo por nada) y descarta los pares ya marcados "no son
 * duplicados" por un humano. O(n²) DENTRO de cada bloque, nunca entre
 * bloques — el catálogo real tiene pocas decenas de productos por
 * categoría+unidad, no miles.
 */
export function findDuplicateCandidates(
  products: DuplicateCandidateProduct[],
  dismissedPairs: Set<DismissedPairKey> = new Set(),
): DuplicateCandidatePair[] {
  const blocks = new Map<string, DuplicateCandidateProduct[]>();
  for (const product of products) {
    const key = `${product.categoryId}::${product.unit}`;
    const block = blocks.get(key) ?? [];
    block.push(product);
    blocks.set(key, block);
  }

  const pairs: DuplicateCandidatePair[] = [];
  for (const block of blocks.values()) {
    for (let i = 0; i < block.length; i += 1) {
      for (let j = i + 1; j < block.length; j += 1) {
        const productA = block[i];
        const productB = block[j];
        if (dismissedPairs.has(dismissedPairKey(productA.id, productB.id))) continue;

        const similarity = diceCoefficient(productA.name, productB.name);
        if (similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
          pairs.push({ productA, productB, similarity, suggestedPrimaryId: suggestPrimary(productA, productB) });
        }
      }
    }
  }

  return pairs.sort((x, y) => y.similarity - x.similarity);
}
