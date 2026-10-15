import { buildInternalBarcode, checksumWarningForCode } from "@/modules/catalog/barcode";

/**
 * prompt-codigos-editar-eliminar.md Fase 1.3 — "issue" por código, puro y
 * testeado aparte de la consulta real (barcode-search-service.ts resuelve
 * los datos; esto solo decide, con los datos ya en la mano). Una fila puede
 * tener varios issues a la vez (p.ej. un HMR- desactualizado en un producto
 * inactivo).
 */
export type BarcodeIssue =
  | "CHECKSUM_INVALID"
  | "PRODUCT_INACTIVE"
  | "PRODUCT_MERGED"
  | "MULTIPLE_CODES"
  | "INTERNAL_SKU_MISMATCH"
  | "NO_PRIMARY";

export type BarcodeIssueInput = {
  code: string;
  kind: "FACTORY" | "INTERNAL" | "SUPPLIER";
  productIsActive: boolean;
  /** Fusión (prompt-codigos-y-duplicados.md Fase 3) — Product.mergedIntoProductId. No debería haber códigos vivos acá después de unificar: si aparece, es señal de un caso que la unificación no limpió. */
  productMergedIntoProductId: string | null;
  productSku: string;
  /** Total de códigos del producto dueño (incluido este). 3+ = MULTIPLE_CODES. */
  siblingCount: number;
  /** El producto dueño tiene ALGÚN código marcado principal — no necesariamente este. */
  productHasPrimary: boolean;
};

const MULTIPLE_CODES_THRESHOLD = 3;

export function detectBarcodeIssues(input: BarcodeIssueInput): BarcodeIssue[] {
  const issues: BarcodeIssue[] = [];
  if (checksumWarningForCode(input.code) !== null) issues.push("CHECKSUM_INVALID");
  if (!input.productIsActive) issues.push("PRODUCT_INACTIVE");
  if (input.productMergedIntoProductId !== null) issues.push("PRODUCT_MERGED");
  if (input.siblingCount >= MULTIPLE_CODES_THRESHOLD) issues.push("MULTIPLE_CODES");
  if (input.kind === "INTERNAL" && input.code !== buildInternalBarcode(input.productSku)) issues.push("INTERNAL_SKU_MISMATCH");
  if (!input.productHasPrimary) issues.push("NO_PRIMARY");
  return issues;
}
