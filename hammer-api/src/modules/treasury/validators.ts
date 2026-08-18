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
