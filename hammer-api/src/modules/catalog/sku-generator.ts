import type { Prisma } from "@prisma/client";

export type SkuInput = {
  productName: string;
  categoryName?: string | null;
  sku?: string | null;
};

type ProductSkuReader = Pick<Prisma.TransactionClient, "product">;

export function normalizeManualSku(sku: string): string {
  return sku
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/Ñ/g, "N")
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function shouldAutoGenerateSku(sku?: string | null): boolean {
  return !sku || !String(sku).trim();
}

function cleanText(value?: string | null): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/Ñ/g, "N")
    .replace(/[^A-Z0-9#./ xX"-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CATEGORY_CODES: Array<{ code: string; patterns: RegExp[] }> = [
  { code: "MAD", patterns: [/MADERA/, /TIMBER/, /TABLA/, /REGLA/, /CUARTON/, /CUARTON/, /CUADRO/, /LISTON/, /VIGA/] },
  { code: "MET", patterns: [/METAL/, /METALICO/, /METALICOS/, /HIERRO/, /ACERO/, /VARILLA/] },
  { code: "ALM", patterns: [/ALAMBRE/, /PUAS?/, /GALVANIZADO/] },
  { code: "CEM", patterns: [/CEMENTO/, /MORTERO/, /CONCRETO/] },
  { code: "AGG", patterns: [/ARENA/, /PIEDRA/, /GRAVA/, /SELECTO/, /BALASTRO/, /AGREGADO/] },
  { code: "BLO", patterns: [/BLOQUE/, /LADRILLO/, /HUELLA/, /ADOQUIN/] },
  { code: "TUB", patterns: [/TUBO/, /TUBERIA/, /PVC/, /CPVC/, /HG/] },
  { code: "PLN", patterns: [/LLAVE/, /VALVULA/, /CODO/, /TEE/, /NIPLE/, /PLOMERIA/, /SANITARIO/] },
  { code: "ELE", patterns: [/CABLE/, /BREAKER/, /TOMA/, /INTERRUPTOR/, /ELECTRICO/, /BOMBILLO/, /LED/] },
  { code: "HER", patterns: [/MARTILLO/, /PALA/, /PICO/, /ALICATE/, /DESTORNILLADOR/, /HERRAMIENTA/] },
  { code: "PIN", patterns: [/PINTURA/, /BROCHA/, /RODILLO/, /THINNER/, /ESMALTE/, /SELLADOR/] },
  { code: "ADH", patterns: [/PEGAMENTO/, /ADHESIVO/, /SILICON/, /SELLADOR/, /CONTACTO/] },
  { code: "SEG", patterns: [/GUANTE/, /CASCO/, /LENTE/, /MASCARILLA/, /EPP/, /SEGURIDAD/] },
  { code: "QUI", patterns: [/ACIDO/, /CLORO/, /QUIMICO/, /LIMPIADOR/] },
  { code: "FER", patterns: [/TORNILLO/, /CLAVO/, /TUERCA/, /ARANDELA/, /BISAGRA/, /CANDADO/] },
];

const FAMILY_CODES: Array<{ code: string; patterns: RegExp[] }> = [
  { code: "CUA", patterns: [/CUARTON/, /CUARTON/, /CUADRO/] },
  { code: "TAB", patterns: [/TABLA/] },
  { code: "REG", patterns: [/REGLA/] },
  { code: "LIS", patterns: [/LISTON/] },
  { code: "VIG", patterns: [/VIGA/] },
  { code: "HIE", patterns: [/HIERRO/] },
  { code: "AMR", patterns: [/AMARRE/] },
  { code: "PUA", patterns: [/PUAS?/] },
  { code: "GAL", patterns: [/GALVANIZADO/] },
  { code: "CEM", patterns: [/CEMENTO/] },
  { code: "MOR", patterns: [/MORTERO/] },
  { code: "CON", patterns: [/CONCRETO/] },
  { code: "ARE", patterns: [/ARENA/] },
  { code: "PDR", patterns: [/PIEDRA/] },
  { code: "GRV", patterns: [/GRAVA/] },
  { code: "BAL", patterns: [/BALASTRO/] },
  { code: "BLQ", patterns: [/BLOQUE/] },
  { code: "LDR", patterns: [/LADRILLO/] },
  { code: "HUE", patterns: [/HUELLA/] },
  { code: "ADQ", patterns: [/ADOQUIN/] },
  { code: "PVC", patterns: [/PVC/] },
  { code: "CPV", patterns: [/CPVC/] },
  { code: "TUB", patterns: [/TUBO/, /TUBERIA/] },
  { code: "CAB", patterns: [/CABLE/] },
  { code: "BRK", patterns: [/BREAKER/] },
  { code: "TOM", patterns: [/TOMA/] },
  { code: "INT", patterns: [/INTERRUPTOR/] },
  { code: "LED", patterns: [/LED/, /BOMBILLO/] },
  { code: "BRO", patterns: [/BROCHA/] },
  { code: "ROD", patterns: [/RODILLO/] },
  { code: "PIN", patterns: [/PINTURA/] },
  { code: "ESM", patterns: [/ESMALTE/] },
  { code: "MAR", patterns: [/MARTILLO/] },
  { code: "PAL", patterns: [/PALA/] },
  { code: "PIC", patterns: [/PICO/] },
  { code: "ALI", patterns: [/ALICATE/] },
  { code: "DES", patterns: [/DESTORNILLADOR/] },
  { code: "GUA", patterns: [/GUANTE/] },
  { code: "CAS", patterns: [/CASCO/] },
  { code: "LEN", patterns: [/LENTE/] },
  { code: "TOR", patterns: [/TORNILLO/] },
  { code: "CLV", patterns: [/CLAVO/] },
  { code: "TUE", patterns: [/TUERCA/] },
  { code: "ARA", patterns: [/ARANDELA/] },
  { code: "CAN", patterns: [/CANDADO/] },
];

function firstMatchCode(text: string, table: Array<{ code: string; patterns: RegExp[] }>): string | null {
  for (const item of table) {
    if (item.patterns.some((pattern) => pattern.test(text))) return item.code;
  }
  return null;
}

function fallbackCode(text: string, length = 3): string {
  const stopWords = new Set([
    "DE", "DEL", "LA", "EL", "LOS", "LAS", "PARA", "CON", "SIN", "EN", "Y", "UN", "UNA", "POR", "TIPO",
    "COLOR", "GRANDE", "PEQUENO", "PEQUENA", "MEDIANO", "MEDIANA",
  ]);
  const words = cleanText(text)
    .split(" ")
    .map((word) => word.replace(/[^A-Z0-9]/g, ""))
    .filter((word) => word && !stopWords.has(word));
  const base = words[0] || "GEN";
  return base.slice(0, length).padEnd(length, "X");
}

export function detectCategoryCode(productName: string, categoryName?: string | null): string {
  const categoryText = cleanText(categoryName);
  const productText = cleanText(productName);
  const combined = `${categoryText} ${productText}`.trim();
  return (
    firstMatchCode(categoryText, CATEGORY_CODES) ||
    firstMatchCode(productText, CATEGORY_CODES) ||
    firstMatchCode(combined, CATEGORY_CODES) ||
    fallbackCode(categoryText || productText)
  );
}

export function detectFamilyCode(productName: string, categoryCode: string): string {
  const productText = cleanText(productName);
  return firstMatchCode(productText, FAMILY_CODES) || fallbackCode(productText) || categoryCode;
}

function compactVariant(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/PULGADAS?|PULGADA|PULG|"/g, "P")
    .replace(/LIBRAS?|LIBRA/g, "LB")
    .replace(/KILOS?|KILOGRAMOS?|KILOGRAMO/g, "KG")
    .replace(/GALONES?|GALON/g, "GAL")
    .replace(/LITROS?|LITRO/g, "LT")
    .replace(/METROS?|METRO|MTS/g, "M")
    .replace(/CENTIMETROS?|CENTIMETRO/g, "CM")
    .replace(/MILIMETROS?|MILIMETRO/g, "MM")
    .replace(/ROLLOS?|ROLLO/g, "R")
    .replace(/BOLSAS?|BOLSA/g, "BOL")
    .replace(/ONZAS?|ONZA/g, "OZ")
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
}

export function parseWoodDimensions(productName: string): {
  thicknessInches?: number;
  widthInches?: number;
  lengthFeet?: number;
  subtype?: "TABLA" | "REGLA" | "CUARTON" | "CUADRO" | "LISTON" | "VIGA" | "OTRO";
} {
  const text = cleanText(productName);
  const subtype =
    /\bCUARTON\b/.test(text) ? "CUARTON" :
    /\bTABLA\b/.test(text) ? "TABLA" :
    /\bREGLA\b/.test(text) ? "REGLA" :
    /\bCUADRO\b/.test(text) ? "CUADRO" :
    /\bLISTON\b/.test(text) ? "LISTON" :
    /\bVIGA\b/.test(text) ? "VIGA" :
    "OTRO";
  const dimensionMatch = text.match(/\b(\d+(?:\.\d+)?)\s*[Xx]\s*(\d+(?:\.\d+)?)\s*[Xx]\s*(\d+(?:\.\d+)?)\b/);
  if (!dimensionMatch) return { subtype };
  return {
    subtype,
    thicknessInches: Number(dimensionMatch[1]),
    widthInches: Number(dimensionMatch[2]),
    lengthFeet: Number(dimensionMatch[3]),
  };
}

export function detectVariant(productName: string): string {
  const text = cleanText(productName);
  const woodDimensions = parseWoodDimensions(productName);
  if (
    woodDimensions.thicknessInches !== undefined &&
    woodDimensions.widthInches !== undefined &&
    woodDimensions.lengthFeet !== undefined
  ) {
    return `${woodDimensions.thicknessInches}${woodDimensions.widthInches}${woodDimensions.lengthFeet}`.replace(/[^0-9]/g, "").slice(0, 10);
  }
  const patterns: RegExp[] = [
    /#\s*(\d+[A-Z]?)/,
    /\b(\d+(?:\.\d+)?)\s*(KG|KILO|KILOS|KILOGRAMO|KILOGRAMOS)\b/,
    /\b(\d+(?:\.\d+)?)\s*(LB|LIBRA|LIBRAS)\b/,
    /\b(\d+(?:\.\d+)?)\s*(GALON|GALONES|GAL)\b/,
    /\b(\d+(?:\.\d+)?)\s*(LITRO|LITROS|LT)\b/,
    /\b(\d+(?:\.\d+)?)\s*(MM|CM|MTS|MT|M)\b/,
    /\b(\d+(?:\.\d+)?)\s*(PULGADA|PULGADAS|PULG|")\b/,
    /\b(\d+)\s*(ROLLO|ROLLOS)\b/,
    /\b(\d+)\s*(BOLSA|BOLSAS)\b/,
    /\b(\d+)\s*[Xx]\s*(\d+)\s*[Xx]\s*(\d+)\b/,
    /\b(\d+)\s*[Xx]\s*(\d+)\b/,
    /\b(\d+)\s*(P)\b/,
    /\b(\d+)\s*(OZ|ONZA|ONZAS)\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const variant = compactVariant(match.slice(1).filter(Boolean).join(""));
      if (variant) return variant;
    }
  }
  const knownWords: Array<{ code: string; patterns: RegExp[] }> = [
    { code: "GDE", patterns: [/GRANDE/] },
    { code: "MED", patterns: [/MEDIANO/, /MEDIANA/] },
    { code: "PEQ", patterns: [/PEQUENO/, /PEQUENA/] },
    { code: "NEG", patterns: [/NEGRO/, /NEGRA/] },
    { code: "BLA", patterns: [/BLANCO/, /BLANCA/] },
    { code: "ROJ", patterns: [/ROJO/, /ROJA/] },
    { code: "AZU", patterns: [/AZUL/] },
    { code: "VER", patterns: [/VERDE/] },
  ];
  return firstMatchCode(text, knownWords) || "STD";
}

export function buildSkuBase(input: SkuInput): string {
  const productName = cleanText(input.productName);
  if (!productName) throw new Error("No se puede generar SKU: el nombre del producto esta vacio.");
  const cat = detectCategoryCode(productName, input.categoryName);
  const fam = detectFamilyCode(productName, cat);
  const variant = detectVariant(productName);
  return `${cat}-${fam}-${variant}`;
}

export function buildSkuFromBase(base: string, sequence: number): string {
  const normalizedBase = normalizeManualSku(base);
  return `${normalizedBase}-${String(sequence).padStart(4, "0")}`;
}

export function nextSequenceFromSkus(base: string, skus: string[]): number {
  const normalizedBase = normalizeManualSku(base);
  let max = 0;
  const pattern = new RegExp(`^${normalizedBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d{4})$`);
  for (const sku of skus) {
    const match = normalizeManualSku(sku).match(pattern);
    if (!match) continue;
    max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

export async function generateSkuForProduct(
  prismaClient: ProductSkuReader,
  input: SkuInput,
  reservedSkus: Set<string> = new Set(),
): Promise<string> {
  if (!shouldAutoGenerateSku(input.sku)) {
    const normalizedManualSku = normalizeManualSku(String(input.sku));
    if (normalizedManualSku) return normalizedManualSku;
  }

  const base = buildSkuBase(input);
  const existing = await prismaClient.product.findMany({
    where: { sku: { startsWith: `${base}-` } },
    select: { sku: true },
  });
  let sequence = nextSequenceFromSkus(base, [...existing.map((item) => item.sku), ...reservedSkus]);
  let candidate = buildSkuFromBase(base, sequence);
  while (reservedSkus.has(candidate)) {
    sequence += 1;
    candidate = buildSkuFromBase(base, sequence);
  }
  return candidate;
}
