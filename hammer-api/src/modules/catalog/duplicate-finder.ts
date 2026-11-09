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

  normalized = normalized
    // `1/2"` / `1/2 PULG` / `1/2 PULGADA(S)` → `1/2`: con o sin comilla es la misma medida ("ZINC 26 X 12"" = "ZINC 26 X 12").
    .replace(/(\d+\/\d+|\d+)\s*(?:"|''|”|PULGADAS?\b|PULG\b\.?)/g, "$1")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\bP\//g, "PARA ")
    .replace(/\bC\//g, "CON ")
    .replace(/#(?=\d)/g, "")
    .replace(/\bNO\.?\s*(?=\d)/g, "")
    // "3 1/2" → "3-1/2" y "3 X 3" → "3X3": una medida es UNA palabra (si no, "2X2X4" y "2X4X4" serían el mismo conjunto).
    .replace(/(\d)[\s-]+(?=\d+\/\d+)/g, "$1-")
    .replace(/(\d)\s*X\s*(?=\d)/g, "$1X")
    .replace(UNIT_AFTER_NUMBER, "$1$2")
    .replace(/[(),;:!?¿¡*"'”]/g, " ")
    .replace(/(?<!\d)[.-]|[.-](?!\d)/g, " ");

  return normalized.replace(/\s+/g, " ").trim();
}

/** Abreviaturas que el catálogo escribe de varias formas — se comparan en su forma corta. */
const UNIT_ALIASES: Record<string, string> = {
  GALON: "GL", GALONES: "GL", GLN: "GL", GAL: "GL",
  LIBRA: "LB", LIBRAS: "LB", LBS: "LB",
  KILO: "KG", KILOS: "KG", KGS: "KG",
  GR: "G", GRS: "G", GRAMOS: "G",
  METRO: "M", METROS: "M", MT: "M", MTS: "M",
  LITRO: "L", LITROS: "L", LT: "L", LTS: "L",
  PC: "PCS", PZ: "PCS", PZA: "PCS", PZAS: "PCS", PIEZA: "PCS", PIEZAS: "PCS",
  ONZ: "OZ", ONZAS: "OZ",
  UND: "UD", UNID: "UD", UNIDAD: "UD", UNIDADES: "UD",
};
// Galón NO se pega: "1/4 GL" = "1/4" (el catálogo escribe la presentación con o sin GL).
const UNIT_WORDS = [...new Set([...Object.keys(UNIT_ALIASES), ...Object.values(UNIT_ALIASES), "MM", "CM", "ML", "FT", "W", "V"])].filter((w) => UNIT_ALIASES[w] !== "GL" && w !== "GL");
/** "100 PCS" → "100PCS", "42.5 KG" → "42.5KG". */
const UNIT_AFTER_NUMBER = new RegExp(`(\\d)\\s+(${UNIT_WORDS.join("|")})(?![A-Z])`, "g");

/** Palabras de relleno: "LLAVE PARA JARDIN" = "LLAVE JARDIN". */
const STOPWORDS = new Set(["DE", "DEL", "PARA", "CON", "Y", "E", "EL", "LA", "LOS", "LAS", "EN", "A", "AL", "X", "POR"]);

/**
 * Palabras comparables de un nombre: abreviaturas unificadas (GALON→GL,
 * 50KGS→50KG), sin relleno y sin plural (BISAGRAS = BISAGRA). Solo para
 * duplicados — la búsqueda por prefijo de barcode-suggestions sigue usando
 * normalizeForDuplicateMatch tal cual ("gal" tiene que seguir encontrando "galvanizado").
 */
function duplicateTokens(name: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normalizeForDuplicateMatch(name).split(" ")) {
    if (!raw) continue;
    const glued = /^(\d[\d./-]*)([A-Z]+)$/.exec(raw);
    let token = glued ? glued[1] + (UNIT_ALIASES[glued[2]] ?? glued[2]) : (UNIT_ALIASES[raw] ?? raw);
    if (STOPWORDS.has(token)) continue;
    if (/^[A-Z]{5,}$/.test(token) && token.endsWith("S") && !token.endsWith("SS")) token = token.slice(0, -1);
    out.add(token);
  }
  return out;
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
  categoryName?: string;
  unit: string;
  barcode: string | null;
  totalStock: number;
  createdAt: Date;
};

export type DuplicateConfidence = "HIGH" | "MEDIUM" | "LOW";

export type DuplicateCandidatePair = {
  productA: DuplicateCandidateProduct;
  productB: DuplicateCandidateProduct;
  similarity: number;
  confidence: DuplicateConfidence;
  /** Por qué se sugiere, en palabras: "Escrito distinto: PCV ≈ PVC", "Solo uno dice: GL". */
  reason: string;
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

/** Contención (una incluye todas las palabras de la otra) pide al menos esto de parecido: "SUR FASTYL" no es duplicado de "SUR FASTYL ROJO OXIDO GL". */
const CONTAINMENT_MIN_SIMILARITY = 0.6;

/** Distancia de edición contando como 1 el cambio de lugar de dos letras vecinas (PCV/PVC). */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** OXIDO/OXIDOO, HOLCIN/HOLCIM, PCV/PVC sí; ROJO/ROSA, ROJO/VERDE o PVC/CPVC no — esos son otro producto. */
function looksLikeTypo(a: string, b: string): boolean {
  if (!/^[A-Z]+$/.test(a) || !/^[A-Z]+$/.test(b)) return false;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 3) return false;
  const distance = editDistance(a, b);
  if (shorter === 3) return distance === 1 && a.length === b.length && [...a].sort().join("") === [...b].sort().join("");
  return distance <= (shorter >= 7 ? 2 : 1);
}

function removeOnce(list: string[], value: string) {
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
}

/** Empareja (y saca de las listas) las palabras distintas que son la misma escrita distinto: FASTDRY = FAST DRY, OXIDOO ≈ OXIDO. */
function pairUpDifferences(onlyA: string[], onlyB: string[]): string[] {
  const fixes: string[] = [];
  for (const [from, to] of [[onlyA, onlyB], [onlyB, onlyA]]) {
    for (const word of [...from]) {
      if (!/^[A-Z]+$/.test(word)) continue;
      const head = to.find((x) => x !== word && word.startsWith(x) && word.slice(x.length) !== x && to.includes(word.slice(x.length)));
      if (!head) continue;
      const tail = word.slice(head.length);
      removeOnce(from, word);
      removeOnce(to, head);
      removeOnce(to, tail);
      fixes.push(`${head} ${tail} = ${word}`);
    }
  }
  for (const a of [...onlyA]) {
    const b = onlyB.find((x) => looksLikeTypo(a, x));
    if (!b) continue;
    removeOnce(onlyA, a);
    removeOnce(onlyB, b);
    fixes.push(`${a} ≈ ${b}`);
  }
  return fixes;
}

type TokenMatch = { similarity: number; fixes: string[]; extrasA: string[]; extrasB: string[] };

/**
 * ¿Mismo producto escrito distinto? Las palabras que NO comparten deciden,
 * no un umbral ciego (0.8 marcaba "SUR FASTYL ROJO OXIDO 1/4" ≈ "SUR FASTYL VERDE OXIDO 1/4"):
 *  - palabras con error de tipeo o pegadas (FASTDRY/FAST DRY) se emparejan primero;
 *  - lo que queda distinto con dígitos (1/4 vs nada, 42.5KG vs 50KG) = otra medida → no;
 *  - una contiene todas las palabras de la otra, en cualquier orden → sí (con las de más a la vista);
 *  - quedan palabras distintas en los dos lados (ROJO vs VERDE) → no.
 */
function tokenMatch(tokensA: Set<string>, tokensB: Set<string>): TokenMatch | null {
  const onlyA = [...tokensA].filter((t) => !tokensB.has(t));
  const onlyB = [...tokensB].filter((t) => !tokensA.has(t));
  const shared = tokensA.size - onlyA.length;
  if (shared === 0) return null;
  const total = tokensA.size + tokensB.size;
  // Emparejar tipeos solo si ya comparten bastante: "LISA PVC" vs "LIJA PVC" no alcanza.
  const fixes = onlyA.length > 0 && onlyB.length > 0 && shared >= 2 && (2 * shared) / total >= 0.5 ? pairUpDifferences(onlyA, onlyB) : [];
  if ([...onlyA, ...onlyB].some((t) => /\d/.test(t))) return null;
  const matched = shared + fixes.length;
  const similarity = onlyA.length === 0 && onlyB.length === 0 && fixes.length === 0 ? 1 : Math.min(1, (2 * matched) / total);
  if (onlyA.length === 0 && onlyB.length === 0) return { similarity, fixes, extrasA: [], extrasB: [] };
  if ((onlyA.length === 0 || onlyB.length === 0) && matched >= 2 && similarity >= CONTAINMENT_MIN_SIMILARITY) return { similarity, fixes, extrasA: onlyA, extrasB: onlyB };
  return null;
}

export function duplicateNameSimilarity(a: string, b: string): number | null {
  return tokenMatch(duplicateTokens(a), duplicateTokens(b))?.similarity ?? null;
}

const SYSTEMATIC_EXTRA_MIN_PAIRS = 3;
const CONFIDENCE_RANK: Record<DuplicateConfidence, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/**
 * Candidatos a duplicado en TODO el catálogo activo (el duplicado típico es
 * justo el que se creó en otra categoría). Unidad distinta no bloquea la
 * sugerencia: la fusión ya pide confirmarla (UNIT_MISMATCH).
 *
 * Confianza: HIGH = mismas palabras o solo tipeos; MEDIUM = uno dice algo de
 * más ("GL", una marca); LOW = el nombre corto calza con VARIAS versiones
 * distintas ("BISAGRAS PAR 3X3" vs TF, FANAL y NH) — eso suele ser un
 * genérico frente a sus marcas, no un duplicado; o la misma palabra de más
 * separa 3+ pares ("ZINC ESTANDAR" vs "ZINC LISO ESTANDAR" en cada medida). ~1,300 productos = ~850k
 * pares de conjuntos chicos, ms.
 */
export function findDuplicateCandidates(
  products: DuplicateCandidateProduct[],
  dismissedPairs: Set<DismissedPairKey> = new Set(),
): DuplicateCandidatePair[] {
  const tokens = products.map((p) => duplicateTokens(p.name));
  const found: Array<{ i: number; j: number; match: TokenMatch }> = [];
  // Por producto "corto" (el que no tiene palabras de más): qué palabras de más le encontraron en cada par.
  const extrasByShorter = new Map<number, Set<string>>();
  // Cuántos pares separa la MISMA palabra de más: "LISO" en 8 pares de zinc es una línea aparte, no un duplicado.
  const pairsByExtras = new Map<string, number>();
  for (let i = 0; i < products.length; i += 1) {
    for (let j = i + 1; j < products.length; j += 1) {
      const match = tokenMatch(tokens[i], tokens[j]);
      if (match === null) continue;
      if (dismissedPairs.has(dismissedPairKey(products[i].id, products[j].id))) continue;
      found.push({ i, j, match });
      const extras = [...match.extrasA, ...match.extrasB];
      if (extras.length === 0) continue;
      const shorter = match.extrasA.length === 0 ? i : j;
      const seen = extrasByShorter.get(shorter) ?? new Set<string>();
      const extrasKey = extras.sort().join(" ");
      seen.add(extrasKey);
      extrasByShorter.set(shorter, seen);
      pairsByExtras.set(extrasKey, (pairsByExtras.get(extrasKey) ?? 0) + 1);
    }
  }

  const pairs = found.map(({ i, j, match }): DuplicateCandidatePair => {
    const productA = products[i];
    const productB = products[j];
    const extras = [...match.extrasA, ...match.extrasB];
    const parts: string[] = [];
    let confidence: DuplicateConfidence = "HIGH";
    if (extras.length === 0 && match.fixes.length === 0) {
      parts.push(normalizeForDuplicateMatch(productA.name) === normalizeForDuplicateMatch(productB.name) ? "Mismo nombre" : "Mismas palabras, en otro orden o abreviadas");
    }
    if (match.fixes.length > 0) parts.push(`Escrito distinto: ${match.fixes.join(", ")}`);
    if (extras.length > 0) {
      const shorter = match.extrasA.length === 0 ? i : j;
      const variants = extrasByShorter.get(shorter)?.size ?? 0;
      const sameExtraPairs = pairsByExtras.get(extras.sort().join(" ")) ?? 0;
      confidence = variants >= 2 || sameExtraPairs >= SYSTEMATIC_EXTRA_MIN_PAIRS ? "LOW" : "MEDIUM";
      parts.push(`Solo uno dice: ${extras.join(" ")}`);
      if (variants >= 2) parts.push(`"${products[shorter].name}" calza con ${variants} versiones distintas — puede ser el genérico frente a sus marcas`);
      else if (sameExtraPairs >= SYSTEMATIC_EXTRA_MIN_PAIRS) parts.push(`"${extras.join(" ")}" separa ${sameExtraPairs} pares — parece una línea aparte`);
    }
    return { productA, productB, similarity: match.similarity, confidence, reason: parts.join(" · "), suggestedPrimaryId: suggestPrimary(productA, productB) };
  });

  return pairs.sort((x, y) => CONFIDENCE_RANK[x.confidence] - CONFIDENCE_RANK[y.confidence] || y.similarity - x.similarity);
}
