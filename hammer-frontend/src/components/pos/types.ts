// Shared domain types for the POS module.
// All hooks and the orchestrator component import from here.

export type ProductRow = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  categoryName?: string | null;
  standardSalePrice: string;
  branchPrice?: string | null;
  effectivePrice?: string;
  priceSource?: "BRANCH" | "STANDARD";
  unit: string;
  stockOnHand?: number;
  availableStock?: number;
  availableBaseStock?: number;
  availableSaleStock?: number;
  baseUnit?: string;
  saleUnit?: string;
  stockConversion?: {
    stockGroupId: string;
    stockGroupCode: string;
    stockGroupName: string;
    baseUnit: string;
    packageUnit?: string | null;
    saleUnit: string;
    conversionFactor: string | number;
    conversionFactorToBase?: string | number | null;
    tracksPackages?: boolean;
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
      autoOpenablePackages?: number;
      autoOpenableUnitsTotal?: number;
      equivalentBaseQuantity: number;
      conversionFactor: number;
      packageUnit: string;
      baseUnit: string;
    } | null;
  } | null;
};

export type TicketLine = {
  id: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  lineSubtotal: string;
  product?: { name?: string; sku?: string };
};

export type TicketOrder = {
  id: string;
  orderNumber: string;
  status: string;
  grandTotal: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  transportAmount?: string;
  notes?: string | null;
  lines?: TicketLine[];
};

export type InventoryBalanceRow = {
  productId: string;
  quantityOnHand: string;
  availableSaleStock?: number;
  sharedStock?: { saleQuantity: number } | null;
};

export type PosV2Context = {
  workflow: {
    enableCashier: boolean;
    enableDispatch: boolean;
    paymentWorkflowMode: "QUEUE_ONLY" | "DIRECT_ONLY" | "HYBRID";
    dispatchWorkflowMode: "DISABLED" | "ENABLED";
  };
  permissions: {
    canSendToCashier: boolean;
    canCollectHere: boolean;
    canUseCashSession: boolean;
  };
  assignedSessions: Array<{ id: string; physicalCashBox?: { code: string; description?: string | null } }>;
  messages?: {
    noCashBoxes?: string | null;
    noAssignedSession?: string | null;
  };
};
