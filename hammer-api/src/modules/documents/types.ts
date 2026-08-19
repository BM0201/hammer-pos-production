/**
 * Tipos compartidos para generación de documentos comerciales.
 * FASE 3 — H.A.M.M.E.R. POS/ERP
 */

export type DocumentLineItem = {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  lineSubtotal: number;
};

export type DocumentOrderData = {
  orderNumber: string;
  deliveryOrderNumber: string | null;
  branchName: string;
  branchCode: string;
  branchAddress?: string;
  branchPhone?: string;
  customerName: string | null;
  customerRuc?: string | null;
  sellerName: string;
  cashierName?: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  requiresTransport: boolean;
  transportAmount: number;
  paymentMethod: string | null;
  lines: DocumentLineItem[];
  createdAt: string;
  paidAt?: string;
  notes?: string;
};

export type ManualInvoiceData = {
  series: string;
  number: string;
  date: string;
  customerName: string;
  customerRuc: string;
  notes?: string;
};

export type PrintSettingsData = {
  paperWidth: "W58MM" | "W80MM" | "A4";
  fontSize: number;
  logoUrl?: string | null;
  footerText?: string | null;
  showQr: boolean;
};

export type DocumentGenerationOptions = {
  order: DocumentOrderData;
  settings: PrintSettingsData;
  manualInvoice?: ManualInvoiceData;
};
