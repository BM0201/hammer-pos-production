"use client";

/**
 * prompt-alta-productos-qr.md Fase 3 — orquestación del lado del cliente
 * compartida entre la pantalla de alta rápida y la ficha de producto
 * (product-360.tsx): resuelve el ancho de papel de la sucursal, arma el
 * HTML con buildLabelsHtml (puro) y dispara printHtml + recordPrintAudit.
 * No es pura a propósito (hace fetch/print); la lógica que SÍ importa
 * testear sin red vive en product-labels.ts.
 */
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { printHtml, recordPrintAudit } from "@/lib/printing";
import { buildLabelsHtml, type LabelPaperWidth, type LabelProductInput } from "@/lib/product-labels";

export type PrintableProduct = LabelProductInput & { id: string };

function resolvePaperWidth(raw: unknown): LabelPaperWidth {
  return raw === "W58MM" ? "W58MM" : "W80MM";
}

/**
 * Imprime etiquetas para los productos con barcode (los que no tienen se
 * omiten — buildLabelsHtml ya los salta, acá solo se cuentan para avisar).
 * Sin configuración de impresión para la sucursal, cae a 80mm.
 */
export async function printProductLabels(input: {
  products: PrintableProduct[];
  branchId: string;
  copies?: number;
  showPrice?: boolean;
}): Promise<{ printed: number; skipped: number }> {
  const printable = input.products.filter((p) => p.barcode);
  const skipped = input.products.length - printable.length;
  if (printable.length === 0) return { printed: 0, skipped };

  let paperWidth: LabelPaperWidth = "W80MM";
  try {
    const res = await apiFetch(`/api/master/print-settings/${input.branchId}`);
    if (res.ok) {
      const settings = unwrapApiData(await res.json()) as { paperWidth?: unknown } | null;
      paperWidth = resolvePaperWidth(settings?.paperWidth);
    }
  } catch {
    // Sin configuración registrada para la sucursal -> 80mm por defecto.
  }

  const html = buildLabelsHtml(printable, {
    paperWidth,
    copies: input.copies ?? 1,
    showPrice: input.showPrice ?? true,
  });
  printHtml(html);

  for (const product of printable) {
    await recordPrintAudit({
      branchId: input.branchId,
      entityType: "Product",
      entityId: product.id,
      documentType: "PRODUCT_LABEL",
    });
  }

  return { printed: printable.length, skipped };
}
