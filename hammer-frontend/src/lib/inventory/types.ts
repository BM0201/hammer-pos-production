/**
 * Forma mínima que `formatSharedStock` (shared-stock-format.ts) necesita para
 * describir el stock compartido de una fusión — sea cual sea el dominio
 * (agregados, hierro, lo que venga). Cualquier `ProductRow` con estos campos
 * la satisface estructuralmente; no hace falta importar el tipo completo del
 * backend.
 */
export type ProductStockView = {
  stockConversion?: {
    stockGroupName: string;
    baseUnit: string;
    packageUnit?: string | null;
    saleUnit: string;
    conversionFactor: string | number;
    tracksPackages?: boolean;
    approximateFactor?: boolean;
    isPackagePresentation?: boolean;
    isCanonical: boolean;
  } | null;
  sharedStock?: {
    baseQuantity: number;
    saleQuantity: number;
    baseUnit: string;
    saleUnit: string;
    packageStock?: {
      closedPackageQuantity: number;
      looseUnitQuantity: number;
      equivalentBaseQuantity: number;
      conversionFactor: number;
      packageUnit: string;
      baseUnit: string;
    } | null;
  } | null;
};
