import { z } from "zod";

const currencyCodeSchema = z.enum(["NIO", "USD"]);

export const createBankAccountSchema = z.object({
  bankName: z.string().min(1).max(100),
  accountAlias: z.string().min(1).max(100),
  accountNumber: z.string().min(1).max(50),
  currencyCode: currencyCodeSchema.optional(),
  branchId: z.string().cuid().optional().nullable(),
  owner: z.string().max(150).optional().nullable(),
  acceptsCustomerPayments: z.boolean().optional(),
  /** BANK por defecto — Master solo crea SAFE a mano (§6.5); SETTLEMENT y
   * CUSTODY se autocrean (prompt-libro-mayor-tesoreria.md §3). */
  type: z.enum(["BANK", "SAFE"]).optional(),
});

export const updateBankAccountSchema = z.object({
  bankName: z.string().min(1).max(100).optional(),
  accountAlias: z.string().min(1).max(100).optional(),
  accountNumber: z.string().min(1).max(50).optional(),
  currencyCode: currencyCodeSchema.optional(),
  branchId: z.string().cuid().optional().nullable(),
  isActive: z.boolean().optional(),
  owner: z.string().max(150).optional().nullable(),
  acceptsCustomerPayments: z.boolean().optional(),
});

/**
 * prompt-libro-mayor-tesoreria.md §5 — el saldo de apertura se declara una
 * vez, a una fecha de corte; desde ahí corre el libro. No es "editar el
 * saldo": es el punto de partida del que se calcula todo lo demás.
 */
export const setOpeningBalanceSchema = z.object({
  openingBalance: z.coerce.number(),
  openingBalanceAt: z.coerce.date(),
});

/**
 * prompt-libro-mayor-tesoreria.md §3/§7 pruebas 6-7: confirmar resuelve una
 * custodia ESPECÍFICA (de dónde salió la plata), no "agregar un depósito
 * suelto". Si el monto confirmado es menor al que hay en esa custodia, el
 * resto se queda ahí — no se ajusta solo.
 */
export const confirmBankDepositSchema = z.object({
  custodyAccountId: z.string().cuid(),
  bankAccountId: z.string().cuid(),
  branchId: z.string().cuid(),
  amount: z.coerce.number().positive(),
  referenceNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

/**
 * Depósito directo: el acumulado de la sucursal (getBranchCashPosition) va
 * directo a una cuenta bancaria en córdobas, sin pasar por "enviar a alguien
 * y confirmar después". El tope real (pendingDeposit) se recalcula en el
 * servidor — este schema no lo valida, solo la forma del payload.
 */
export const directBranchDepositSchema = z.object({
  branchId: z.string().cuid(),
  bankAccountId: z.string().cuid(),
  amount: z.coerce.number().positive(),
  referenceNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const declareCashDestinationSchema = z.object({
  cashSessionId: z.string().cuid(),
  branchId: z.string().cuid(),
  handOverAmount: z.coerce.number().min(0),
  handOverUserId: z.string().cuid().optional().nullable(),
  depositAmount: z.coerce.number().min(0),
  depositCarrierUserId: z.string().cuid().optional().nullable(),
  depositBankAccountId: z.string().cuid().optional().nullable(),
  retainAmount: z.coerce.number().min(0),
  awaitingDepositLocation: z.enum(["DRAWER", "SAFE"]).default("DRAWER"),
  notes: z.string().max(500).optional().nullable(),
});

/**
 * prompt-indicador-efectivo-inteligente.md §4 — "Enviar depósito" o
 * "Entregar en persona" con la sesión de caja TODAVÍA ABIERTA. No espera
 * al cierre: si el umbral se alcanza a media mañana, esperar deja más
 * plata sentada más tiempo.
 */
export const sendCashOutSchema = z.object({
  cashSessionId: z.string().cuid(),
  amount: z.coerce.number().positive(),
  carrierUserId: z.string().cuid(),
  reason: z.enum(["DEPOSIT_DISPATCH", "HANDOVER"]),
});

export const setBranchDepositPolicySchema = z.object({
  thresholdAmount: z.coerce.number().positive(),
  maxDaysHolding: z.coerce.number().int().positive(),
});

/**
 * Tarjeta (débito/crédito) ligada a una cuenta de banco. No se acepta el
 * número completo — solo los últimos 4 (identificación visual), nunca PAN/CVV.
 */
export const createTreasuryCardSchema = z.object({
  label: z.string().min(1).max(80),
  brand: z.string().max(40).optional().nullable(),
  last4: z.string().regex(/^\d{4}$/, "Deben ser 4 dígitos").optional().nullable(),
  cardType: z.enum(["DEBIT", "CREDIT"]).optional(),
});

export const updateTreasuryCardSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  brand: z.string().max(40).optional().nullable(),
  last4: z.string().regex(/^\d{4}$/, "Deben ser 4 dígitos").optional().nullable(),
  cardType: z.enum(["DEBIT", "CREDIT"]).optional(),
  isActive: z.boolean().optional(),
});

/**
 * Un pago que SALE de una cuenta registrada (proveedor, planilla o gasto).
 * Baja el saldo esperado de esa cuenta (fila OUT del libro mayor).
 * allowNegativeBalance solo para sobregiro/crédito reales.
 */
export const recordAccountPaymentSchema = z
  .object({
    accountId: z.string().cuid(),
    amount: z.coerce.number().positive(),
    entryType: z.enum(["SUPPLIER_PAYMENT", "PAYROLL", "EXPENSE"]),
    counterpartyType: z.enum(["CUSTOMER", "SUPPLIER", "EMPLOYEE", "ACQUIRER", "INTERNAL", "ADJUSTMENT"]).default("SUPPLIER"),
    counterpartyName: z.string().max(150).optional().nullable(),
    cardId: z.string().cuid().optional().nullable(),
    occurredAt: z.coerce.date().optional(),
    reference: z.string().max(100).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    allowNegativeBalance: z.boolean().optional(),
    // Obligatoria cuando allowNegativeBalance es true — ver superRefine abajo.
    // El mínimo de 10 caracteres es deliberado: obliga a escribir una razón, no una letra.
    overrideReason: z.string().min(10).max(300).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.allowNegativeBalance && !data.overrideReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overrideReason"],
        message: "overrideReason es obligatorio (mínimo 10 caracteres) al usar allowNegativeBalance.",
      });
    }
  });

/**
 * prompt-tesoreria-gasto-retenido-y-techo.md T-1/T-5 — gasto pagado con
 * efectivo retenido (cuenta SAFE), no con la gaveta abierta. receiptReference
 * siempre obligatoria: no hay módulo de documentos/adjuntos en este código
 * base, se decidió una referencia de texto en vez de construir carga de
 * archivos nueva (2026-08-21).
 */
export const recordRetainedCashExpenseSchema = z.object({
  branchId: z.string().cuid(),
  category: z.enum(["PAYROLL", "UTILITIES", "RENT", "FOOD", "MAINTENANCE", "TRANSPORT", "MARKETING", "TAXES", "OTHER"]),
  description: z.string().min(1).max(200),
  amount: z.coerce.number().positive(),
  receiptReference: z.string().min(1).max(150),
});

export const voidRetainedCashExpenseSchema = z.object({
  reason: z.string().min(10).max(300),
});
