import { TrendingUp, TrendingDown, Minus } from "lucide-react";

/**
 * Fase 5 (prompt-flujo-velocidad.md): extraído de product-360.tsx para que
 * kardex-tab.tsx y wac-history-tab.tsx (cargados con next/dynamic) no
 * necesiten importar de vuelta el archivo grande que los carga — mismas
 * funciones, mismo comportamiento, solo movidas.
 */
export function movementLabel(type: string) {
  const map: Record<string, { label: string; color: "success" | "danger" | "warning" | "info" | "neutral" }> = {
    PURCHASE_IN: { label: "Compra / entrada", color: "success" },
    SALE_OUT: { label: "Venta / salida", color: "danger" },
    ADJUSTMENT_IN: { label: "Ajuste entrada", color: "success" },
    ADJUSTMENT_OUT: { label: "Ajuste salida", color: "danger" },
    RETURN_IN: { label: "Devolucion entrada", color: "success" },
    RETURN_OUT: { label: "Devolucion salida", color: "danger" },
    TRANSFER_IN: { label: "Transfer. Entrada", color: "success" },
    TRANSFER_OUT: { label: "Transfer. Salida", color: "warning" },
    TIMBER_INTAKE_IN: { label: "Entrada madera", color: "info" },
    PURCHASE: { label: "Compra", color: "success" },
    SALE: { label: "Venta", color: "danger" },
    ADJUSTMENT_ADD: { label: "Ajuste (+)", color: "success" },
    ADJUSTMENT_SUBTRACT: { label: "Ajuste (−)", color: "danger" },
    IMPORT: { label: "Importación", color: "info" },
    PRODUCTION: { label: "Producción", color: "info" },
    INITIAL_STOCK: { label: "Stock Inicial", color: "info" },
    PHYSICAL_COUNT: { label: "Conteo Físico", color: "warning" },
  };
  return map[type] ?? { label: type, color: "neutral" as const };
}

export function isInboundMovement(type: string) {
  return (
    type.endsWith("_IN") ||
    type.includes("ADD") ||
    type === "PURCHASE" ||
    type === "INITIAL_STOCK" ||
    type === "IMPORT" ||
    type === "PRODUCTION"
  );
}

export function isOutboundMovement(type: string) {
  return type.endsWith("_OUT") || type.includes("SUBTRACT") || type === "SALE";
}

export function MovementIcon({ type }: { type: string }) {
  if (isOutboundMovement(type))
    return <TrendingDown className="h-4 w-4 text-red-500" />;
  if (isInboundMovement(type))
    return <TrendingUp className="h-4 w-4 text-emerald-500" />;
  return <Minus className="h-4 w-4 text-slate-400" />;
}

export function wacRefLabel(referenceType: string) {
  return ({
    OPENING_BALANCE: "Carga inicial",
    OPENING_BALANCE_BULK: "Carga masiva",
    MANUAL_ADJUSTMENT: "Ajuste manual",
    SALE: "Venta",
    SALE_RETURN: "Devolución",
    SALE_RETURN_DAMAGED: "Devolución (dañado)",
    SALE_CANCEL: "Anulación de venta",
    PURCHASE: "Compra",
    TRANSFER: "Traslado",
    MANUAL: "Manual",
  } as Record<string, string>)[referenceType] ?? referenceType;
}
