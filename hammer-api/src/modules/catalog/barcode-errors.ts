/**
 * prompt-alta-productos-qr.md Fase 1 — el P2002 crudo de Product.barcode
 * salía como el CONFLICT genérico de http.ts (sin decir cuál producto ya
 * tiene ese código). `existingProduct` viaja en el error para que la UI de
 * alta rápida pueda ofrecer "Ver producto" sin una segunda consulta.
 *
 * prompt-codigos-y-duplicados.md Fase 1 — separado de catalog/service.ts a
 * su propio archivo para que product-barcode-service.ts lo pueda importar
 * sin crear un ciclo (service.ts importa addBarcode de vuelta desde ahí).
 * Mismo patrón que detector-registry.ts (brain/engine.ts ↔ brain/service.ts).
 */
export class BarcodeAlreadyExistsError extends Error {
  constructor(
    message: string,
    // isActive: para que addBarcode (product-barcode-service.ts) pueda decir
    // "ese código es de un producto INACTIVO" sin una segunda consulta;
    // createProduct (catalog/service.ts) sigue sin usarlo, el campo es
    // opcional así que no rompe nada.
    public readonly existingProduct: { id: string; name: string; sku: string; barcode: string; isActive?: boolean },
  ) {
    super(message);
    this.name = "BarcodeAlreadyExistsError";
  }
}
