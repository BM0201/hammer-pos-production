import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { Prisma, type RetainedCashLocation, type TreasuryAccountType, type TreasuryEntryType, type TreasuryCounterpartyType, type CurrencyCode } from "@prisma/client";
import { decomposeRetainedAmount, computeExposureAlert, type ExposureAlertThreshold } from "@/modules/treasury/decomposition";
import { computeOutstandingAwaitingDeposit, countBusinessDaysBetween } from "@/modules/treasury/exposure";
import { logAuditEvent } from "@/modules/audit/service";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Cuentas de tesorería (Master-only salvo CUSTODY, que se autocrea) ────

export async function createBankAccount(input: {
  bankName: string;
  accountAlias: string;
  accountNumber: string;
  currencyCode?: CurrencyCode;
  branchId?: string | null;
  owner?: string | null;
  acceptsCustomerPayments?: boolean;
  type?: TreasuryAccountType;
  actorUserId: string;
}) {
  const account = await prisma.treasuryAccount.create({
    data: {
      bankName: input.bankName,
      accountAlias: input.accountAlias,
      accountNumber: input.accountNumber,
      currencyCode: input.currencyCode ?? "NIO",
      branchId: input.branchId ?? null,
      owner: input.owner ?? null,
      acceptsCustomerPayments: input.acceptsCustomerPayments ?? true,
      type: input.type ?? "BANK",
    },
  });
  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId ?? undefined,
    module: "treasury",
    action: "TREASURY_ACCOUNT_CREATED",
    entityType: "TreasuryAccount",
    entityId: account.id,
    metadataJson: { bankName: account.bankName, accountAlias: account.accountAlias, type: account.type },
  });
  return account;
}

export async function updateBankAccount(id: string, input: {
  bankName?: string;
  accountAlias?: string;
  accountNumber?: string;
  currencyCode?: CurrencyCode;
  branchId?: string | null;
  isActive?: boolean;
  owner?: string | null;
  acceptsCustomerPayments?: boolean;
  actorUserId: string;
}) {
  const account = await prisma.treasuryAccount.update({
    where: { id },
    data: {
      bankName: input.bankName,
      accountAlias: input.accountAlias,
      accountNumber: input.accountNumber,
      currencyCode: input.currencyCode,
      branchId: input.branchId,
      isActive: input.isActive,
      owner: input.owner,
      acceptsCustomerPayments: input.acceptsCustomerPayments,
    },
  });
  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: account.branchId ?? undefined,
    module: "treasury",
    action: "TREASURY_ACCOUNT_UPDATED",
    entityType: "TreasuryAccount",
    entityId: account.id,
  });
  return account;
}

/**
 * prompt-libro-mayor-tesoreria.md §5: el saldo de apertura se declara UNA
 * vez, a una fecha de corte — nunca se vuelve a pisar libremente. Se
 * permite reemplazarlo (no solo fijarlo la primera vez) porque un corte
 * puede necesitar corregirse, pero cada llamada queda auditada con el
 * valor anterior.
 */
export async function setOpeningBalance(input: { accountId: string; openingBalance: number; openingBalanceAt: Date; actorUserId: string }) {
  const previous = await prisma.treasuryAccount.findUniqueOrThrow({ where: { id: input.accountId }, select: { openingBalance: true, openingBalanceAt: true, branchId: true } });
  const account = await prisma.treasuryAccount.update({
    where: { id: input.accountId },
    data: { openingBalance: input.openingBalance, openingBalanceAt: input.openingBalanceAt },
  });
  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: previous.branchId ?? undefined,
    module: "treasury",
    action: "TREASURY_ACCOUNT_OPENING_BALANCE_SET",
    entityType: "TreasuryAccount",
    entityId: account.id,
    metadataJson: {
      previousOpeningBalance: previous.openingBalance.toString(),
      previousOpeningBalanceAt: previous.openingBalanceAt,
      openingBalance: input.openingBalance,
      openingBalanceAt: input.openingBalanceAt,
    },
  });
  return account;
}

/**
 * branchId: cuentas de esa sucursal + centrales (branchId null). Sin
 * branchId: todas (vista admin). `forPayments`: filtra a
 * acceptsCustomerPayments=true, tipo BANK, y ordena por lastUsedAt — "menos
 * opciones previene el error mejor que agrandar el botón" + "ordenadas por
 * uso" (prompt-pantallas-recorrido-dinero.md §1.3). Sin `forPayments`, se
 * listan todas (vista admin de Tesorería), de cualquier tipo.
 */
export async function listBankAccounts(branchId?: string | null, forPayments = false) {
  return prisma.treasuryAccount.findMany({
    where: {
      isActive: true,
      ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      ...(forPayments ? { acceptsCustomerPayments: true, type: "BANK" } : {}),
    },
    orderBy: forPayments
      ? [{ lastUsedAt: { sort: "desc", nulls: "last" } }, { bankName: "asc" }]
      : [{ type: "asc" }, { branchId: "asc" }, { bankName: "asc" }],
  });
}

// ─── El libro mayor (§2) — primitivas de escritura ────────────────────────

type EntryLinkage = {
  cashMovementId?: string | null;
  paymentTenderId?: string | null;
  bankDepositId?: string | null;
  expensePaymentId?: string | null;
  cardId?: string | null;
};

type CreateEntryInput = EntryLinkage & {
  accountId: string;
  direction: "IN" | "OUT";
  /** SIEMPRE positivo — el signo lo da direction (§2.2). */
  amount: number;
  entryType: TreasuryEntryType;
  counterpartyType: TreasuryCounterpartyType;
  counterpartyName?: string | null;
  occurredAt?: Date;
  transferId?: string | null;
  reference?: string | null;
  notes?: string | null;
  createdByUserId: string;
};

/**
 * La primitiva de escritura del libro mayor — SIEMPRE dentro de una
 * transacción del llamador. currencyCode se toma de la cuenta, nunca del
 * input: así el invariante 3 (currencyCode de la entrada = currencyCode de
 * su cuenta) queda garantizado por construcción, no por validación aparte.
 */
export async function createTreasuryEntryTx(tx: Prisma.TransactionClient, input: CreateEntryInput) {
  if (input.amount <= 0) throw new Error("VALIDATION_ERROR: el monto de una entrada de tesorería debe ser mayor que 0");
  const account = await tx.treasuryAccount.findUniqueOrThrow({ where: { id: input.accountId }, select: { currencyCode: true } });
  return tx.treasuryEntry.create({
    data: {
      accountId: input.accountId,
      direction: input.direction,
      amount: input.amount,
      currencyCode: account.currencyCode,
      occurredAt: input.occurredAt ?? new Date(),
      transferId: input.transferId ?? null,
      entryType: input.entryType,
      counterpartyType: input.counterpartyType,
      counterpartyName: input.counterpartyName ?? null,
      cashMovementId: input.cashMovementId ?? null,
      paymentTenderId: input.paymentTenderId ?? null,
      bankDepositId: input.bankDepositId ?? null,
      expensePaymentId: input.expensePaymentId ?? null,
      cardId: input.cardId ?? null,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      createdByUserId: input.createdByUserId,
    },
  });
}

/**
 * Un movimiento entre DOS cuentas internas — produce dos filas unidas por
 * transferId (§2.2). `toAmount` solo hace falta cuando las cuentas son de
 * monedas distintas (invariante 4: sin tasa, se rechaza); si se omite y las
 * monedas coinciden, se usa el mismo monto en ambos lados.
 *
 * Nunca lleva cashMovementId/paymentTenderId (son @unique en TreasuryEntry
 * — una sola fila puede reclamarlos, no dos). bankDepositId sí puede
 * compartirse (no es @unique): las dos patas de una confirmación de
 * depósito referencian el MISMO BankDeposit.
 */
export async function createInternalTransferTx(tx: Prisma.TransactionClient, input: {
  fromAccountId: string;
  toAccountId: string;
  fromAmount: number;
  toAmount?: number;
  entryType: TreasuryEntryType;
  counterpartyType: TreasuryCounterpartyType;
  counterpartyName?: string | null;
  occurredAt?: Date;
  bankDepositId?: string | null;
  reference?: string | null;
  notes?: string | null;
  createdByUserId: string;
}) {
  // Invariante 2: ninguna entrada con transferId tiene la misma cuenta en los dos lados.
  if (input.fromAccountId === input.toAccountId) {
    throw new Error("VALIDATION_ERROR: una transferencia interna no puede tener la misma cuenta en los dos lados");
  }
  const [fromAccount, toAccount] = await Promise.all([
    tx.treasuryAccount.findUniqueOrThrow({ where: { id: input.fromAccountId }, select: { currencyCode: true } }),
    tx.treasuryAccount.findUniqueOrThrow({ where: { id: input.toAccountId }, select: { currencyCode: true } }),
  ]);
  // Invariante 4: monedas distintas exigen el monto de destino ya convertido — sin él, se rechaza.
  if (fromAccount.currencyCode !== toAccount.currencyCode && input.toAmount === undefined) {
    throw new Error("VALIDATION_ERROR: transferencia entre cuentas de distinta moneda requiere el monto de destino (tipo de cambio aplicado)");
  }
  const toAmount = input.toAmount ?? input.fromAmount;
  const transferId = randomUUID();

  const outEntry = await createTreasuryEntryTx(tx, {
    accountId: input.fromAccountId,
    direction: "OUT",
    amount: input.fromAmount,
    transferId,
    entryType: input.entryType,
    counterpartyType: input.counterpartyType,
    counterpartyName: input.counterpartyName,
    occurredAt: input.occurredAt,
    bankDepositId: input.bankDepositId,
    reference: input.reference,
    notes: input.notes,
    createdByUserId: input.createdByUserId,
  });
  const inEntry = await createTreasuryEntryTx(tx, {
    accountId: input.toAccountId,
    direction: "IN",
    amount: toAmount,
    transferId,
    entryType: input.entryType,
    counterpartyType: input.counterpartyType,
    counterpartyName: input.counterpartyName,
    occurredAt: input.occurredAt,
    bankDepositId: input.bankDepositId,
    reference: input.reference,
    notes: input.notes,
    createdByUserId: input.createdByUserId,
  });

  return { outEntry, inEntry, transferId };
}

// ─── Autocreación de cuentas no-bancarias ─────────────────────────────────

/**
 * Una cuenta CUSTODY por persona — se autocrea la primera vez que alguien
 * declara "entregar" o "a depositar" (prompt-libro-mayor-tesoreria.md §3).
 * Pedirle a Master que precargue una fila por empleado antes de poder
 * declarar sería pedir un dato que todavía no hace falta.
 */
export async function findOrCreateCustodyAccountTx(tx: Prisma.TransactionClient, input: { holderUserId: string; branchId: string | null }) {
  const code = `CUSTODY-${input.holderUserId}`;
  const existing = await tx.treasuryAccount.findUnique({ where: { code } });
  if (existing) return existing;

  const holder = await tx.user.findUniqueOrThrow({ where: { id: input.holderUserId }, select: { fullName: true } });
  return tx.treasuryAccount.create({
    data: {
      type: "CUSTODY",
      code,
      bankName: "Custodia",
      accountAlias: holder.fullName,
      accountNumber: "",
      currencyCode: "NIO",
      branchId: input.branchId,
      holderUserId: input.holderUserId,
      owner: holder.fullName,
      acceptsCustomerPayments: false,
    },
  });
}

/**
 * Una sola cuenta SETTLEMENT central — el adquirente de tarjeta no liquida
 * por sucursal, liquida por comercio. Se autocrea al primer cobro con
 * tarjeta (prompt-libro-mayor-tesoreria.md §3).
 */
export async function findOrCreateSettlementAccountTx(tx: Prisma.TransactionClient) {
  const code = "SETTLEMENT-CENTRAL";
  const existing = await tx.treasuryAccount.findUnique({ where: { code } });
  if (existing) return existing;
  return tx.treasuryAccount.create({
    data: {
      type: "SETTLEMENT",
      code,
      bankName: "Adquirente",
      accountAlias: "Por liquidar",
      accountNumber: "",
      currencyCode: "NIO",
      branchId: null,
      acceptsCustomerPayments: false,
    },
  });
}

/**
 * A diferencia de CUSTODY/SETTLEMENT, la caja fuerte NO se autocrea — "si
 * la hay" es una pregunta física que solo Master puede contestar (§8 del
 * doc de pantallas). Sin una cuenta SAFE configurada para la sucursal, la
 * declaración de "retener" no genera fila de libro mayor.
 */
export async function findSafeAccountForBranch(db: Prisma.TransactionClient | typeof prisma, branchId: string) {
  return db.treasuryAccount.findFirst({ where: { type: "SAFE", branchId, isActive: true } });
}

// ─── Saldos (§2.3) — SIEMPRE calculados, nunca guardados ──────────────────

export type TreasuryAccountBalance = {
  openingBalance: number;
  openingBalanceAt: Date | null;
  totalIn: number;
  totalOut: number;
  balance: number;
  /** Sin fecha de apertura declarada, el número de abajo es solo el neto
   * de movimientos desde que el libro empezó a registrar — no el saldo
   * real de la cuenta. La pantalla lo tiene que decir (§5/prueba 15). */
  pendingOpening: boolean;
};

/**
 * §2.3 — la fórmula del saldo, aislada como función pura para poder
 * probarla con una secuencia armada a mano (§7 prueba 11) sin base de
 * datos. No se materializa en ningún lado: quien la necesita, la llama.
 */
export function computeAccountBalance(openingBalance: number, totalIn: number, totalOut: number): number {
  return round2(openingBalance + totalIn - totalOut);
}

export async function getTreasuryAccountBalance(accountId: string): Promise<TreasuryAccountBalance> {
  const account = await prisma.treasuryAccount.findUniqueOrThrow({ where: { id: accountId }, select: { openingBalance: true, openingBalanceAt: true } });
  const [inAgg, outAgg] = await Promise.all([
    prisma.treasuryEntry.aggregate({ where: { accountId, direction: "IN" }, _sum: { amount: true } }),
    prisma.treasuryEntry.aggregate({ where: { accountId, direction: "OUT" }, _sum: { amount: true } }),
  ]);
  const openingBalance = Number(account.openingBalance);
  const totalIn = Number(inAgg._sum.amount ?? 0);
  const totalOut = Number(outAgg._sum.amount ?? 0);
  return {
    openingBalance,
    openingBalanceAt: account.openingBalanceAt,
    totalIn,
    totalOut,
    balance: computeAccountBalance(openingBalance, totalIn, totalOut),
    pendingOpening: account.openingBalanceAt === null,
  };
}

/**
 * §2.4 — saldo corriente calculado hacia ADELANTE desde el saldo de
 * apertura, nunca hacia atrás desde el saldo actual (insertar una entrada
 * vieja reescribiría todas las líneas posteriores de forma invisible). Las
 * entradas YA deben venir en el orden canónico (occurredAt, createdAt, id)
 * — esta función no ordena, solo acumula.
 */
export function applyRunningBalance<T extends { direction: "IN" | "OUT"; amount: number }>(
  openingBalance: number,
  entries: T[],
): (T & { runningBalance: number })[] {
  let running = openingBalance;
  return entries.map((entry) => {
    const signed = entry.direction === "IN" ? entry.amount : -entry.amount;
    running = round2(running + signed);
    return { ...entry, runningBalance: running };
  });
}

/** Lista de cuentas + su saldo real (libro mayor), para la pantalla de Tesorería. */
export async function listBankAccountsWithBalances(branchId?: string | null) {
  const accounts = await listBankAccounts(branchId);
  return Promise.all(accounts.map(async (account) => ({
    ...account,
    balance: await getTreasuryAccountBalance(account.id),
  })));
}

/**
 * §6.1 — la posición total, agrupada por tipo de cuenta y moneda (nunca
 * sumada entre monedas sin decir a qué tasa). "En sucursales" (gavetas +
 * SAFE) se completa en el caller con CashSession — la gaveta no es una
 * cuenta de tesorería (§1), este módulo no la conoce.
 */
export async function getTreasuryPosition(branchId?: string | null) {
  const accounts = await prisma.treasuryAccount.findMany({
    where: { isActive: true, ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}) },
  });
  const balances = await Promise.all(accounts.map(async (account) => ({ account, ...(await getTreasuryAccountBalance(account.id)) })));

  function groupByCurrency(type: TreasuryAccountType) {
    const rows = balances.filter((b) => b.account.type === type);
    const byCurrency: Record<string, number> = {};
    for (const row of rows) byCurrency[row.account.currencyCode] = round2((byCurrency[row.account.currencyCode] ?? 0) + row.balance);
    return { total: round2(rows.reduce((s, r) => s + r.balance, 0)), byCurrency };
  }

  const latestRate = await prisma.exchangeRate.findFirst({ where: { fromCurrency: "USD", toCurrency: "NIO" }, orderBy: { effectiveAt: "desc" } });

  return {
    banks: groupByCurrency("BANK"),
    settlement: groupByCurrency("SETTLEMENT"),
    safe: groupByCurrency("SAFE"),
    custody: groupByCurrency("CUSTODY"),
    latestExchangeRate: latestRate ? { rate: Number(latestRate.rate), effectiveAt: latestRate.effectiveAt } : null,
    accountsPendingOpening: balances.filter((b) => b.pendingOpening).map((b) => ({ id: b.account.id, bankName: b.account.bankName, accountAlias: b.account.accountAlias, type: b.account.type })),
  };
}

/**
 * §6.3 — detalle con saldo corriente, calculado hacia ADELANTE desde el
 * saldo de apertura (§2.4) — nunca hacia atrás desde el saldo actual, o
 * insertar una entrada vieja reescribiría todas las líneas posteriores de
 * forma invisible. Orden canónico: (occurredAt, createdAt, id).
 */
export async function getTreasuryAccountLedger(accountId: string, range?: { from?: Date; to?: Date }) {
  const account = await prisma.treasuryAccount.findUniqueOrThrow({ where: { id: accountId } });
  const entries = await prisma.treasuryEntry.findMany({
    where: { accountId },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  const rows = applyRunningBalance(
    Number(account.openingBalance),
    entries.map((entry) => ({ ...entry, amount: Number(entry.amount) })),
  );

  if (!range?.from && !range?.to) {
    return { account, rows, rangeStartBalance: Number(account.openingBalance) };
  }
  const from = range.from ?? new Date(0);
  const to = range.to ?? new Date(8_640_000_000_000_000);
  const before = rows.filter((r) => r.occurredAt < from);
  const rangeStartBalance = before.length > 0 ? before[before.length - 1].runningBalance : Number(account.openingBalance);
  return { account, rows: rows.filter((r) => r.occurredAt >= from && r.occurredAt <= to), rangeStartBalance };
}

// ─── Enganche: venta con tender TRANSFER/CARD (§3, §8 paso 2) ─────────────

/**
 * Se llama justo después de crear los PaymentTender de una venta
 * (payments/service.ts y sales/service.ts). Nunca bloquea la venta: si la
 * cuenta no existe o algo falla, se registra en auditoría y se sigue — el
 * libro mayor es una capa de contabilidad sobre la venta, no un requisito
 * para que la venta exista (mismo principio que
 * checkStockGroupHealth: "nunca tumba la operación real").
 */
export async function recordSaleTenderEntriesTx(
  tx: Prisma.TransactionClient,
  input: {
    tenders: Array<{ id: string; method: string; amount: number | Prisma.Decimal; bankAccountId?: string | null }>;
    occurredAt: Date;
    createdByUserId: string;
    customerName?: string | null;
  },
) {
  for (const tender of input.tenders) {
    try {
      if (tender.method === "TRANSFER" && tender.bankAccountId) {
        await createTreasuryEntryTx(tx, {
          accountId: tender.bankAccountId,
          direction: "IN",
          amount: Number(tender.amount),
          entryType: "SALE_TRANSFER",
          counterpartyType: "CUSTOMER",
          counterpartyName: input.customerName ?? null,
          occurredAt: input.occurredAt,
          paymentTenderId: tender.id,
          createdByUserId: input.createdByUserId,
        });
      } else if (tender.method === "CARD") {
        const settlementAccount = await findOrCreateSettlementAccountTx(tx);
        await createTreasuryEntryTx(tx, {
          accountId: settlementAccount.id,
          direction: "IN",
          amount: Number(tender.amount),
          entryType: "SALE_CARD",
          counterpartyType: "CUSTOMER",
          counterpartyName: input.customerName ?? null,
          occurredAt: input.occurredAt,
          paymentTenderId: tender.id,
          createdByUserId: input.createdByUserId,
        });
      }
      // CASH: ninguna entrada — el efectivo vive en CashSession (§1/§3).
    } catch (error) {
      await logAuditEvent({
        actorUserId: input.createdByUserId,
        module: "treasury",
        action: "TREASURY_ENTRY_WRITE_FAILED",
        entityType: "PaymentTender",
        entityId: tender.id,
        metadataJson: { method: tender.method, bankAccountId: tender.bankAccountId ?? null, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}

// ─── Depósitos confirmados (§3, §7 pruebas 6-7) ───────────────────────────

/**
 * Confirma un depósito resolviendo una custodia ESPECÍFICA — de dónde salió
 * la plata (prompt-libro-mayor-tesoreria.md §3, §6.4, §7 pruebas 6-7). Si
 * el monto confirmado es menor al que hay en esa custodia, el resto se
 * queda ahí: no se ajusta solo. Escribe las dos patas (OUT custodia + IN
 * banco) con el mismo transferId.
 */
export async function confirmBankDeposit(input: {
  custodyAccountId: string;
  bankAccountId: string;
  branchId: string;
  amount: number;
  confirmedByUserId: string;
  referenceNumber?: string | null;
  notes?: string | null;
}) {
  if (input.amount <= 0) throw new Error("INVALID_DEPOSIT_AMOUNT: el monto depositado debe ser mayor que 0");

  return prisma.$transaction(async (tx) => {
    const custodyBalance = await getTreasuryAccountBalance(input.custodyAccountId);
    if (input.amount > custodyBalance.balance + 0.01) {
      throw new Error(`VALIDATION_ERROR: el monto confirmado (C$${input.amount}) supera lo que hay en custodia (C$${custodyBalance.balance})`);
    }

    const deposit = await tx.bankDeposit.create({
      data: {
        bankAccountId: input.bankAccountId,
        branchId: input.branchId,
        amount: input.amount,
        confirmedByUserId: input.confirmedByUserId,
        referenceNumber: input.referenceNumber ?? null,
        notes: input.notes ?? null,
      },
    });

    const { transferId } = await createInternalTransferTx(tx, {
      fromAccountId: input.custodyAccountId,
      toAccountId: input.bankAccountId,
      fromAmount: input.amount,
      entryType: "DEPOSIT_CONFIRMED",
      counterpartyType: "INTERNAL",
      occurredAt: new Date(),
      bankDepositId: deposit.id,
      reference: input.referenceNumber ?? null,
      notes: input.notes ?? null,
      createdByUserId: input.confirmedByUserId,
    });

    const remainder = round2(custodyBalance.balance - input.amount);
    await logAuditEvent({
      actorUserId: input.confirmedByUserId,
      branchId: input.branchId,
      module: "treasury",
      action: "BANK_DEPOSIT_CONFIRMED",
      entityType: "BankDeposit",
      entityId: deposit.id,
      metadataJson: {
        custodyAccountId: input.custodyAccountId,
        bankAccountId: input.bankAccountId,
        amountConfirmed: input.amount,
        custodyBalanceBefore: custodyBalance.balance,
        remainderInCustody: remainder,
        transferId,
        discrepant: remainder > 0.01,
      },
    });

    return { deposit, transferId, remainderInCustody: remainder };
  });
}

/** §6.1/Pantalla 4 — cuentas CUSTODY con saldo > 0: lo que hay "en tránsito" a la espera de que alguien lo confirme. */
export async function listCustodyAccountsWithBalance(branchId?: string | null) {
  const accounts = await prisma.treasuryAccount.findMany({
    where: { type: "CUSTODY", isActive: true, ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}) },
    include: { holderUser: { select: { id: true, fullName: true } }, branch: { select: { id: true, code: true, name: true } } },
  });
  const withBalance = await Promise.all(accounts.map(async (account) => ({ account, balance: await getTreasuryAccountBalance(account.id) })));
  return withBalance.filter((row) => row.balance.balance > 0.01);
}

/**
 * Estado de exposición de una sucursal (§1.3): cuánto está esperando
 * depósito ahora mismo, y desde hace cuántos días hábiles — sin bloquear
 * nada, solo informa. `threshold` es explícito porque ningún doc fija un
 * número; sin threshold, `exceeds` siempre es false.
 */
export async function getBranchExposureStatus(branchId: string, threshold: ExposureAlertThreshold | null, now: Date = new Date()) {
  const [declarations, deposits] = await Promise.all([
    prisma.cashDestinationDeclaration.findMany({
      where: { branchId, retainAwaitingDepositPortion: { gt: 0 } },
      select: { createdAt: true, retainAwaitingDepositPortion: true },
    }),
    prisma.bankDeposit.findMany({
      where: { branchId },
      select: { depositedAt: true, amount: true },
    }),
  ]);

  const outstanding = computeOutstandingAwaitingDeposit(
    declarations.map((d) => ({ createdAt: d.createdAt, amount: Number(d.retainAwaitingDepositPortion) })),
    deposits.map((d) => ({ depositedAt: d.depositedAt, amount: Number(d.amount) })),
  );
  const businessDays = outstanding.oldestOutstandingDate
    ? countBusinessDaysBetween(outstanding.oldestOutstandingDate, now)
    : 0;

  return {
    ...outstanding,
    businessDaysWithoutDeposit: businessDays,
    alert: computeExposureAlert(outstanding.outstandingAmount, businessDays, threshold),
  };
}

// ─── Declaración de destino del efectivo al cerrar caja (§1) ──────────────

export async function declareCashDestination(input: {
  cashSessionId: string;
  branchId: string;
  declaredByUserId: string;
  handOverAmount: number;
  handOverUserId?: string | null;
  depositAmount: number;
  depositCarrierUserId?: string | null;
  depositBankAccountId?: string | null;
  retainAmount: number;
  awaitingDepositLocation: RetainedCashLocation;
  notes?: string | null;
}) {
  if (input.handOverAmount < 0 || input.depositAmount < 0 || input.retainAmount < 0) {
    throw new Error("VALIDATION_ERROR: los montos no pueden ser negativos");
  }
  // "quién lo recibe cuando sale" es lo único obligatorio — no hay motivo
  // que capturar, son la misma pregunta con tres respuestas posibles (§1).
  if (input.handOverAmount > 0 && !input.handOverUserId) {
    throw new Error("VALIDATION_ERROR: falta la persona que recibe la entrega");
  }
  if (input.depositAmount > 0 && !input.depositCarrierUserId) {
    throw new Error("VALIDATION_ERROR: falta la persona que lleva el depósito");
  }
  // Cuenta destino obligatoria cuando hay dónde elegir — mismo criterio que
  // el selector de transferencias del cobro: sin ninguna cuenta cargada no
  // se puede pedir un dato que no existe, pero si hay al menos una, no
  // queda "opcional" (prompt-pantallas-recorrido-dinero.md §3).
  if (input.depositAmount > 0 && !input.depositBankAccountId) {
    const accountsAvailable = await prisma.treasuryAccount.count({
      where: { isActive: true, type: "BANK", OR: [{ branchId: input.branchId }, { branchId: null }] },
    });
    if (accountsAvailable > 0) {
      throw new Error("VALIDATION_ERROR: falta la cuenta destino del depósito");
    }
  }

  return prisma.$transaction(async (tx) => {
    const session = await tx.cashSession.findUniqueOrThrow({ where: { id: input.cashSessionId } });
    if (session.status !== "CLOSED") {
      throw new Error("CASH_SESSION_NOT_CLOSED: la declaración de destino se hace sobre una sesión ya cerrada");
    }
    const existing = await tx.cashDestinationDeclaration.findUnique({ where: { cashSessionId: input.cashSessionId } });
    // Una declaración AUTO-DEFAULTED (creada por el sistema al revisar una
    // caja auto-cerrada, sin que nadie eligiera nada) sí se puede
    // reemplazar por la real — es exactamente lo que el doc pide: "queda
    // pendiente de declaración real en la revisión de esa caja". Una
    // declaración real ya hecha por una persona, no.
    if (existing && !existing.isAutoDefaulted) {
      throw new Error("DECLARATION_ALREADY_EXISTS: esta sesión ya tiene una declaración de destino");
    }

    // El total declarado debe corresponder al efectivo realmente contado al
    // cierre — los tres destinos cubren TODO el efectivo, no un subconjunto.
    const counted = Number(session.countedCashAmount ?? 0);
    const total = Math.round((input.handOverAmount + input.depositAmount + input.retainAmount) * 100) / 100;
    if (Math.abs(total - counted) > 0.01) {
      throw new Error(`DECLARATION_MISMATCH: la declaración (C$${total}) no coincide con el efectivo contado al cierre (C$${counted})`);
    }

    const branch = await tx.branch.findUniqueOrThrow({ where: { id: input.branchId }, select: { cashFundAmount: true } });
    const decomposition = decomposeRetainedAmount(input.retainAmount, branch.cashFundAmount ? Number(branch.cashFundAmount) : null);

    const data = {
      branchId: input.branchId,
      declaredByUserId: input.declaredByUserId,
      handOverAmount: input.handOverAmount,
      handOverUserId: input.handOverAmount > 0 ? input.handOverUserId : null,
      depositAmount: input.depositAmount,
      depositCarrierUserId: input.depositAmount > 0 ? input.depositCarrierUserId : null,
      depositBankAccountId: input.depositBankAccountId ?? null,
      retainAmount: input.retainAmount,
      retainCashFundPortion: decomposition.cashFundPortion,
      retainAwaitingDepositPortion: decomposition.awaitingDepositPortion,
      awaitingDepositLocation: input.retainAmount > 0 ? input.awaitingDepositLocation : "DRAWER" as const,
      notes: input.notes ?? null,
      isAutoDefaulted: false,
    };
    // upsert, no create: si había una auto-defaulted (existing.isAutoDefaulted
    // === true, ver arriba) la declaración real la reemplaza en la misma fila.
    const declaration = await tx.cashDestinationDeclaration.upsert({
      where: { cashSessionId: input.cashSessionId },
      create: { cashSessionId: input.cashSessionId, ...data },
      update: data,
    });

    await writeDeclarationLedgerEntriesTx(tx, declaration, input.declaredByUserId);

    await logAuditEvent({
      actorUserId: input.declaredByUserId,
      branchId: input.branchId,
      module: "treasury",
      action: existing ? "CASH_DESTINATION_DECLARED_OVER_AUTO_DEFAULT" : "CASH_DESTINATION_DECLARED",
      entityType: "CashDestinationDeclaration",
      entityId: declaration.id,
      metadataJson: {
        cashSessionId: input.cashSessionId,
        handOverAmount: input.handOverAmount,
        depositAmount: input.depositAmount,
        retainAmount: input.retainAmount,
        retainCashFundPortion: decomposition.cashFundPortion,
        retainAwaitingDepositPortion: decomposition.awaitingDepositPortion,
      },
    });

    return declaration;
  });
}

/**
 * Escribe las filas de libro mayor de una declaración (§3): Depositar → IN
 * a la CUSTODY del que lo lleva; Entregar → IN a la CUSTODY de quien lo
 * recibe; Retener → IN a SAFE si la sucursal tiene una configurada (si no,
 * ninguna fila — el efectivo se queda en la gaveta, que no es tesorería).
 * Sin cashMovementId: declarar destino hoy no crea un CashMovement propio
 * (la gaveta se queda con el conteo del cierre), así que no hay un
 * movimiento real que enlazar — se documenta acá en vez de forzar un enlace
 * que no existe.
 */
async function writeDeclarationLedgerEntriesTx(
  tx: Prisma.TransactionClient,
  declaration: { id: string; branchId: string; depositAmount: Prisma.Decimal; depositCarrierUserId: string | null; depositBankAccountId: string | null; handOverAmount: Prisma.Decimal; handOverUserId: string | null; retainAmount: Prisma.Decimal; retainAwaitingDepositPortion: Prisma.Decimal },
  actorUserId: string,
) {
  const deposit = Number(declaration.depositAmount);
  if (deposit > 0 && declaration.depositCarrierUserId) {
    const custody = await findOrCreateCustodyAccountTx(tx, { holderUserId: declaration.depositCarrierUserId, branchId: declaration.branchId });
    await createTreasuryEntryTx(tx, {
      accountId: custody.id,
      direction: "IN",
      amount: deposit,
      entryType: "DEPOSIT_DISPATCH",
      counterpartyType: "EMPLOYEE",
      createdByUserId: actorUserId,
      notes: `Declaración de cierre ${declaration.id}`,
    });
  }

  const handOver = Number(declaration.handOverAmount);
  if (handOver > 0 && declaration.handOverUserId) {
    const custody = await findOrCreateCustodyAccountTx(tx, { holderUserId: declaration.handOverUserId, branchId: declaration.branchId });
    await createTreasuryEntryTx(tx, {
      accountId: custody.id,
      direction: "IN",
      amount: handOver,
      entryType: "HANDOVER",
      counterpartyType: "EMPLOYEE",
      createdByUserId: actorUserId,
      notes: `Declaración de cierre ${declaration.id}`,
    });
  }

  const retain = Number(declaration.retainAmount);
  if (retain > 0) {
    const safe = await findSafeAccountForBranch(tx, declaration.branchId);
    if (safe) {
      await createTreasuryEntryTx(tx, {
        accountId: safe.id,
        direction: "IN",
        amount: retain,
        entryType: "RETAIN_TO_SAFE",
        counterpartyType: "INTERNAL",
        createdByUserId: actorUserId,
        notes: `Declaración de cierre ${declaration.id}`,
      });
    }
    // Sin caja fuerte configurada: ninguna fila — se queda en la gaveta,
    // que no es tesorería (§1/§3, "ninguna si no hay caja fuerte").
  }
}

/**
 * Se llama desde reviewAutoClosedCashSession (cash-session/service.ts) al
 * momento en que una caja auto-cerrada por el cron obtiene por fin un
 * countedCashAmount real (nadie contó nada al momento del auto-cierre). Todo
 * va a Retener — es la verdad física, la plata se quedó donde estaba, no
 * una intención inventada (prompt-pantallas-recorrido-dinero.md §3, "El
 * cierre automático").
 */
export async function createAutoDefaultedDeclarationTx(
  tx: Prisma.TransactionClient,
  input: { cashSessionId: string; branchId: string; countedCashAmount: number; actorUserId: string },
) {
  const existing = await tx.cashDestinationDeclaration.findUnique({ where: { cashSessionId: input.cashSessionId } });
  if (existing) return existing;

  const branch = await tx.branch.findUniqueOrThrow({ where: { id: input.branchId }, select: { cashFundAmount: true } });
  const decomposition = decomposeRetainedAmount(
    Math.max(0, input.countedCashAmount),
    branch.cashFundAmount ? Number(branch.cashFundAmount) : null,
  );

  const declaration = await tx.cashDestinationDeclaration.create({
    data: {
      cashSessionId: input.cashSessionId,
      branchId: input.branchId,
      declaredByUserId: input.actorUserId,
      handOverAmount: 0,
      depositAmount: 0,
      retainAmount: Math.max(0, input.countedCashAmount),
      retainCashFundPortion: decomposition.cashFundPortion,
      retainAwaitingDepositPortion: decomposition.awaitingDepositPortion,
      awaitingDepositLocation: "DRAWER",
      isAutoDefaulted: true,
    },
  });

  await writeDeclarationLedgerEntriesTx(tx, declaration, input.actorUserId);

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "treasury",
    action: "CASH_DESTINATION_AUTO_DEFAULTED",
    entityType: "CashDestinationDeclaration",
    entityId: declaration.id,
    metadataJson: { cashSessionId: input.cashSessionId, retainAmount: input.countedCashAmount },
  });

  return declaration;
}

/**
 * "Ordenadas por uso, para que la memoria muscular funcione"
 * (prompt-pantallas-recorrido-dinero.md §1.3) — se llama cada vez que un
 * PaymentTender de TRANSFER persiste con una cuenta destino.
 */
export async function bumpBankAccountUsageTx(tx: Prisma.TransactionClient, bankAccountIds: (string | null | undefined)[]) {
  const ids = [...new Set(bankAccountIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  await tx.treasuryAccount.updateMany({ where: { id: { in: ids } }, data: { lastUsedAt: new Date() } });
}

// ─── Selector de personas por sucursal (para "entrega en persona" / "lleva el depósito") ──

export async function listActiveBranchMembers(branchId: string) {
  const roles = await prisma.userBranchRole.findMany({
    where: { branchId, isActive: true, user: { isActive: true } },
    select: { user: { select: { id: true, fullName: true, username: true } } },
    distinct: ["userId"],
    orderBy: { user: { fullName: "asc" } },
  });
  return roles.map((r) => r.user);
}



// ─── Tarjetas ligadas a una cuenta ────────────────────────────────────────
//
// El negocio paga proveedores/gastos con tarjetas (débito/crédito) que
// pertenecen a una cuenta bancaria concreta. Modelarlas como filas ligadas a
// la cuenta permite registrar un pago "con la tarjeta X" y que el saldo baje
// en la MISMA cuenta a la que pertenece la tarjeta — sin duplicar cuentas ni
// inventar un saldo aparte por tarjeta (la tarjeta no tiene saldo propio: es
// un instrumento de su cuenta).

export async function createTreasuryCard(input: {
  accountId: string;
  label: string;
  brand?: string | null;
  last4?: string | null;
  cardType?: "DEBIT" | "CREDIT";
  actorUserId: string;
}) {
  const account = await prisma.treasuryAccount.findUniqueOrThrow({
    where: { id: input.accountId },
    select: { id: true, type: true, branchId: true },
  });
  if (account.type !== "BANK") {
    throw new Error("VALIDATION_ERROR: solo las cuentas de banco pueden tener tarjetas ligadas");
  }
  const card = await prisma.treasuryCard.create({
    data: {
      accountId: input.accountId,
      label: input.label,
      brand: input.brand ?? null,
      last4: input.last4 ?? null,
      cardType: input.cardType ?? "DEBIT",
    },
  });
  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: account.branchId ?? undefined,
    module: "treasury",
    action: "TREASURY_CARD_CREATED",
    entityType: "TreasuryCard",
    entityId: card.id,
    metadataJson: { accountId: card.accountId, label: card.label, cardType: card.cardType, last4: card.last4 },
  });
  return card;
}

export async function updateTreasuryCard(id: string, input: {
  label?: string;
  brand?: string | null;
  last4?: string | null;
  cardType?: "DEBIT" | "CREDIT";
  isActive?: boolean;
  actorUserId: string;
}) {
  const card = await prisma.treasuryCard.update({
    where: { id },
    data: {
      label: input.label,
      brand: input.brand,
      last4: input.last4,
      cardType: input.cardType,
      isActive: input.isActive,
    },
  });
  await logAuditEvent({
    actorUserId: input.actorUserId,
    module: "treasury",
    action: "TREASURY_CARD_UPDATED",
    entityType: "TreasuryCard",
    entityId: card.id,
    metadataJson: { isActive: card.isActive },
  });
  return card;
}

/** Tarjetas activas de una cuenta. */
export async function listTreasuryCards(accountId: string) {
  return prisma.treasuryCard.findMany({
    where: { accountId, isActive: true },
    orderBy: [{ accountId: "asc" }, { label: "asc" }],
  });
}

type EntrySumRow = { accountId: string; direction: "IN" | "OUT"; _sum: { amount: Prisma.Decimal | number | null } };

/**
 * Arma el TreasuryAccountBalance de cada cuenta a partir de UN groupBy
 * (accountId, direction) en vez de 2 aggregates por cuenta — misma fórmula
 * que getTreasuryAccountBalance (computeAccountBalance), sin duplicarla.
 * Aislada como función pura para poder probarla sin base de datos.
 */
export function assembleAccountBalances(
  accounts: Array<{ id: string; openingBalance: Prisma.Decimal | number; openingBalanceAt: Date | null }>,
  sumRows: EntrySumRow[],
): Map<string, TreasuryAccountBalance> {
  const sums = new Map<string, { in: number; out: number }>();
  for (const row of sumRows) {
    const bucket = sums.get(row.accountId) ?? { in: 0, out: 0 };
    const amount = Number(row._sum.amount ?? 0);
    if (row.direction === "IN") bucket.in += amount;
    else bucket.out += amount;
    sums.set(row.accountId, bucket);
  }

  const result = new Map<string, TreasuryAccountBalance>();
  for (const account of accounts) {
    const openingBalance = Number(account.openingBalance);
    const { in: totalIn, out: totalOut } = sums.get(account.id) ?? { in: 0, out: 0 };
    result.set(account.id, {
      openingBalance,
      openingBalanceAt: account.openingBalanceAt,
      totalIn,
      totalOut,
      balance: computeAccountBalance(openingBalance, totalIn, totalOut),
      pendingOpening: account.openingBalanceAt === null,
    });
  }
  return result;
}

/**
 * Cuentas de banco + su saldo esperado (libro mayor) + las tarjetas activas
 * ligadas a cada una. Es la vista que la pantalla de Tesorería necesita para
 * mostrar "cuánto hay depositado por cuenta y con qué tarjetas se paga desde
 * ella". Tres consultas fijas, independientes de la cantidad de cuentas —
 * antes eran ~16 round trips a Neon con 5 cuentas (2 aggregates + 1 findMany
 * por cuenta), y esta es la pantalla que el Master abre primero.
 */
export async function listBankAccountsWithBalancesAndCards(branchId?: string | null) {
  const accounts = await listBankAccounts(branchId);
  if (accounts.length === 0) return [];

  const ids = accounts.map((account) => account.id);
  const [sumRows, cards] = await Promise.all([
    prisma.treasuryEntry.groupBy({
      by: ["accountId", "direction"],
      where: { accountId: { in: ids } },
      _sum: { amount: true },
    }),
    prisma.treasuryCard.findMany({
      where: { accountId: { in: ids }, isActive: true },
      orderBy: { label: "asc" },
    }),
  ]);

  const balances = assembleAccountBalances(accounts, sumRows);
  const cardsByAccount = new Map<string, typeof cards>();
  for (const card of cards) {
    const list = cardsByAccount.get(card.accountId) ?? [];
    list.push(card);
    cardsByAccount.set(card.accountId, list);
  }

  return accounts.map((account) => ({
    ...account,
    balance: balances.get(account.id)!,
    cards: cardsByAccount.get(account.id) ?? [],
  }));
}

// ─── Pagos SALIENTES desde una cuenta registrada ──────────────────────────

const OUTGOING_ENTRY_TYPES: TreasuryEntryType[] = ["SUPPLIER_PAYMENT", "PAYROLL", "EXPENSE"];

/**
 * Registra un pago que SALE de una cuenta registrada (proveedor, planilla o
 * gasto) — la pieza que faltaba para que "los pagos se hagan desde esas
 * cuentas" baje el saldo de la cuenta. Produce UNA fila OUT del libro mayor
 * (§2.2: contra el exterior, una sola pata), opcionalmente con la tarjeta
 * usada. Siempre dentro de una transacción del llamador.
 *
 * - La cuenta debe ser BANK y estar activa (no se paga desde una custodia o
 *   una liquidación de tarjeta: esas son bolsillos de tránsito).
 * - Si se indica tarjeta, debe pertenecer a esa misma cuenta y estar activa.
 * - Por defecto NO permite dejar el saldo esperado en negativo (evita el
 *   típico error de teclear de más); `allowNegativeBalance` lo habilita para
 *   los casos reales de sobregiro/tarjeta de crédito.
 */
export async function recordAccountPaymentTx(tx: Prisma.TransactionClient, input: {
  accountId: string;
  amount: number;
  entryType: "SUPPLIER_PAYMENT" | "PAYROLL" | "EXPENSE";
  counterpartyType: TreasuryCounterpartyType;
  counterpartyName?: string | null;
  cardId?: string | null;
  occurredAt?: Date;
  reference?: string | null;
  notes?: string | null;
  expensePaymentId?: string | null;
  allowNegativeBalance?: boolean;
  overrideReason?: string | null;
  createdByUserId: string;
}) {
  if (!OUTGOING_ENTRY_TYPES.includes(input.entryType)) {
    throw new Error("VALIDATION_ERROR: tipo de pago saliente inválido");
  }
  if (input.amount <= 0) {
    throw new Error("VALIDATION_ERROR: el monto del pago debe ser mayor que 0");
  }

  const account = await tx.treasuryAccount.findUniqueOrThrow({
    where: { id: input.accountId },
    select: { id: true, type: true, isActive: true, openingBalance: true },
  });
  if (account.type !== "BANK") {
    throw new Error("VALIDATION_ERROR: solo se puede pagar desde una cuenta de banco registrada");
  }
  if (!account.isActive) {
    throw new Error("VALIDATION_ERROR: la cuenta está inactiva");
  }

  if (input.cardId) {
    const card = await tx.treasuryCard.findUnique({
      where: { id: input.cardId },
      select: { accountId: true, isActive: true },
    });
    if (!card || card.accountId !== input.accountId) {
      throw new Error("VALIDATION_ERROR: la tarjeta no pertenece a esta cuenta");
    }
    if (!card.isActive) {
      throw new Error("VALIDATION_ERROR: la tarjeta está inactiva");
    }
  }

  // Lock de fila: serializa los pagos concurrentes sobre esta misma cuenta.
  // Sin esto, dos pagos simultaneos leen el mismo saldo, ambos pasan el guard
  // y ambos insertan su fila OUT — el saldo esperado queda negativo por una
  // ruta que el guard cree haber cerrado. Se toma siempre, incluso con
  // allowNegativeBalance: un pago con override que corre en paralelo con uno
  // sin override debe serializarse igual, o el override "ayuda" al otro a
  // violar su propio guard.
  await tx.$queryRaw`SELECT id FROM "TreasuryAccount" WHERE id = ${input.accountId} FOR UPDATE`;

  if (!input.allowNegativeBalance) {
    const [inAgg, outAgg] = await Promise.all([
      tx.treasuryEntry.aggregate({ where: { accountId: input.accountId, direction: "IN" }, _sum: { amount: true } }),
      tx.treasuryEntry.aggregate({ where: { accountId: input.accountId, direction: "OUT" }, _sum: { amount: true } }),
    ]);
    const balance = computeAccountBalance(
      Number(account.openingBalance),
      Number(inAgg._sum.amount ?? 0),
      Number(outAgg._sum.amount ?? 0),
    );
    if (round2(balance - input.amount) < 0) {
      throw new Error("VALIDATION_ERROR: el pago dejaría el saldo esperado en negativo");
    }
  }

  // TreasuryEntry no tiene columna para overrideReason (deuda para una
  // migración posterior). Hasta entonces, se antepone a notes con un
  // prefijo reconocible en vez de pisar el texto libre del operador.
  const notes =
    input.allowNegativeBalance && input.overrideReason
      ? `[SOBREGIRO AUTORIZADO] ${input.overrideReason}${input.notes ? `\n${input.notes}` : ""}`
      : (input.notes ?? null);

  return createTreasuryEntryTx(tx, {
    accountId: input.accountId,
    direction: "OUT",
    amount: round2(input.amount),
    entryType: input.entryType,
    counterpartyType: input.counterpartyType,
    counterpartyName: input.counterpartyName ?? null,
    cardId: input.cardId ?? null,
    occurredAt: input.occurredAt,
    reference: input.reference ?? null,
    notes,
    expensePaymentId: input.expensePaymentId ?? null,
    createdByUserId: input.createdByUserId,
  });
}

/** Envoltorio público: abre la transacción y audita el pago saliente. */
export async function recordAccountPayment(input: {
  accountId: string;
  amount: number;
  entryType: "SUPPLIER_PAYMENT" | "PAYROLL" | "EXPENSE";
  counterpartyType: TreasuryCounterpartyType;
  counterpartyName?: string | null;
  cardId?: string | null;
  occurredAt?: Date;
  reference?: string | null;
  notes?: string | null;
  allowNegativeBalance?: boolean;
  overrideReason?: string | null;
  actorUserId: string;
}) {
  const entry = await prisma.$transaction((tx) =>
    recordAccountPaymentTx(tx, { ...input, createdByUserId: input.actorUserId }),
  );
  const account = await prisma.treasuryAccount.findUnique({ where: { id: input.accountId }, select: { branchId: true } });
  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: account?.branchId ?? undefined,
    module: "treasury",
    action: "TREASURY_ACCOUNT_PAYMENT_RECORDED",
    entityType: "TreasuryEntry",
    entityId: entry.id,
    metadataJson: {
      accountId: input.accountId,
      amount: input.amount,
      entryType: input.entryType,
      cardId: input.cardId ?? null,
      counterpartyName: input.counterpartyName ?? null,
      allowNegativeBalance: input.allowNegativeBalance ?? false,
      overrideReason: input.overrideReason ?? null,
    },
  });
  return entry;
}
