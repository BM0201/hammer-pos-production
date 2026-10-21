import { Prisma } from "@prisma/client";
import { WacValidationError } from "@/modules/inventory/wac";

/**
 * prompt-entrada-reintento-precio.md Commit 1 §3 — "el mensaje no sirve:
 * está en inglés, no dice qué producto ni qué hacer, y solo muestra el
 * primer error." `MultiBranchIntakeBranch.errorJson` guarda la lista
 * COMPLETA de problemas de esa sucursal, en español, con el producto.
 */
export type IntakeErrorLine = { productId: string; sku: string; name: string; code: string; text: string };
export type IntakeErrorJson = { summary: string; lines: IntakeErrorLine[] };

const WAC_CODE_TEXT: Record<string, (branchCode: string) => string> = {
  ZERO_COST_INBOUND: (branchCode) => `No tiene costo en ${branchCode} y la entrada no traía costo. Escribí el costo de la factura.`,
  NEGATIVE_UNIT_COST: () => "El costo no puede ser negativo.",
  INVALID_MOVEMENT_QUANTITY: () => "La cantidad debe ser mayor a 0.",
  INVALID_INBOUND_QUANTITY: () => "La cantidad debe ser mayor a 0.",
  EXCESSIVE_WAC_JUMP: (branchCode) => `El costo nuevo es muy distinto al promedio actual en ${branchCode}. Revisá el precio o confirmá el salto.`,
  SUSPECTED_PACKAGE_COST_AS_UNIT_COST: () => "El costo parece ser por paquete, no por unidad — revisalo.",
};

/**
 * Un código de WAC no mapeado arriba (NEGATIVE_CURRENT_QUANTITY,
 * NEGATIVE_CURRENT_WAC, NEGATIVE_INVENTORY_VALUE, NEGATIVE_RESULTING_WAC...)
 * es una guarda de consistencia interna, no algo que el usuario causó con
 * un dato de factura — cae al genérico de abajo a propósito, con el
 * detalle técnico solo en el log.
 */
export function mapIntakeErrorToSpanish(error: unknown, branchCode: string): { code: string; text: string } {
  if (error instanceof WacValidationError) {
    const mapper = WAC_CODE_TEXT[error.code];
    if (mapper) return { code: error.code, text: mapper(branchCode) };
    // eslint-disable-next-line no-console
    console.error(`[intake] WacValidationError sin mapeo en español: ${error.code} — ${error.message}`);
    return { code: error.code, text: `Error inesperado al guardar (código ${error.code}).` };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    return { code: "NOT_FOUND", text: "Este producto ya no existe en el catálogo." };
  }

  if (error instanceof Error && error.message.startsWith("VALIDATION_ERROR:")) {
    return { code: "VALIDATION_ERROR", text: error.message.replace(/^VALIDATION_ERROR:\s*/, "") };
  }

  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`[intake] Error no mapeado al guardar en ${branchCode}: ${message}`);
  return { code: "UNKNOWN", text: `Error inesperado al guardar (código ${message.slice(0, 40)}).` };
}

export function buildIntakeErrorJson(lines: IntakeErrorLine[]): IntakeErrorJson {
  if (lines.length === 0) return { summary: "", lines: [] };
  if (lines.length === 1) return { summary: lines[0].text, lines };
  return { summary: `${lines.length} producto(s) con problemas: ${lines[0].text}`, lines };
}
