import { prisma } from "@/lib/prisma";
import { Prisma, type RetainedCashLocation } from "@prisma/client";
import { decomposeRetainedAmount, computeExposureAlert, type ExposureAlertThreshold } from "@/modules/treasury/decomposition";
import { computeOutstandingAwaitingDeposit, countBusinessDaysBetween } from "@/modules/treasury/exposure";
import { logAuditEvent } from "@/modules/audit/service";

// ─── Cuentas bancarias (Master-only, "son varias, se pueden colocar diferentes") ──

export async function createBankAccount(input: {
  bankName: string;
  accountAlias: string;
  accountNumber: string;
  currency?: string;
  branchId?: string | null;
  owner?: string | null;
  acceptsCustomerPayments?: boolean;
  actorUserId: string;
}) {
  const account = await prisma.bankAccount.create({
    data: {
      bankName: input.bankName,
      accountAlias: input.accountAlias,
      accountNumber: input.accountNumber,
      currency: input.currency ?? "NIO",
      branchId: input.branchId ?? null,
      owner: input.owner ?? null,
      acceptsCustomerPayments: input.acceptsCustomerPayments ?? true,
    },
  });
  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId ?? undefined,
    module: "treasury",
    action: "BANK_ACCOUNT_CREATED",
    entityType: "BankAccount",
    entityId: account.id,
    metadataJson: { bankName: account.bankName, accountAlias: account.accountAlias },
  });
  return account;
}

export async function updateBankAccount(id: string, input: {
  bankName?: string;
  accountAlias?: string;
  accountNumber?: string;
  currency?: string;
  branchId?: string | null;
  isActive?: boolean;
  owner?: string | null;
  acceptsCustomerPayments?: boolean;
  actorUserId: string;
}) {
  const account = await prisma.bankAccount.update({
    where: { id },
    data: {
      bankName: input.bankName,
      accountAlias: input.accountAlias,
      accountNumber: input.accountNumber,
      currency: input.currency,
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
    action: "BANK_ACCOUNT_UPDATED",
    entityType: "BankAccount",
    entityId: account.id,
  });
  return account;
}

/**
 * branchId: cuentas de esa sucursal + centrales (branchId null). Sin
 * branchId: todas (vista admin). `forPayments`: filtra a
 * acceptsCustomerPayments=true y ordena por lastUsedAt — "menos opciones
 * previene el error mejor que agrandar el botón" + "ordenadas por uso, para
 * que la memoria muscular funcione" (prompt-pantallas-recorrido-dinero.md
 * §1.3). Sin `forPayments`, se listan todas (vista admin de Tesorería).
 */
export async function listBankAccounts(branchId?: string | null, forPayments = false) {
  return prisma.bankAccount.findMany({
    where: {
      isActive: true,
      ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      ...(forPayments ? { acceptsCustomerPayments: true } : {}),
    },
    orderBy: forPayments
      ? [{ lastUsedAt: { sort: "desc", nulls: "last" } }, { bankName: "asc" }]
      : [{ branchId: "asc" }, { bankName: "asc" }],
  });
}

// ─── Depósitos confirmados (§2.2, una de las dos fuentes del saldo esperado) ──

export async function confirmBankDeposit(input: {
  bankAccountId: string;
  branchId: string;
  amount: number;
  confirmedByUserId: string;
  referenceNumber?: string | null;
  notes?: string | null;
}) {
  if (input.amount <= 0) throw new Error("INVALID_DEPOSIT_AMOUNT: el monto depositado debe ser mayor que 0");
  const deposit = await prisma.bankDeposit.create({
    data: {
      bankAccountId: input.bankAccountId,
      branchId: input.branchId,
      amount: input.amount,
      confirmedByUserId: input.confirmedByUserId,
      referenceNumber: input.referenceNumber ?? null,
      notes: input.notes ?? null,
    },
  });
  await logAuditEvent({
    actorUserId: input.confirmedByUserId,
    branchId: input.branchId,
    module: "treasury",
    action: "BANK_DEPOSIT_CONFIRMED",
    entityType: "BankDeposit",
    entityId: deposit.id,
    metadataJson: { bankAccountId: input.bankAccountId, amount: input.amount },
  });
  return deposit;
}

/**
 * Saldo esperado de una cuenta (§2.2): depósitos confirmados + transferencias
 * recibidas a esa cuenta − pagos hechos desde esa cuenta. El tercer término
 * (pagos a proveedores hechos desde una cuenta bancaria) todavía no existe
 * como funcionalidad en Hammer — queda en 0 a propósito, documentado, no
 * inventado. Cuando exista ese camino, sumar acá su resta.
 */
export async function getBankAccountExpectedBalance(bankAccountId: string) {
  const [depositsAgg, tendersAgg] = await Promise.all([
    prisma.bankDeposit.aggregate({ where: { bankAccountId }, _sum: { amount: true } }),
    prisma.paymentTender.aggregate({ where: { bankAccountId, method: "TRANSFER" }, _sum: { amount: true } }),
  ]);
  const confirmedDeposits = Number(depositsAgg._sum.amount ?? 0);
  const transfersReceived = Number(tendersAgg._sum.amount ?? 0);
  const paymentsMadeFromAccount = 0; // sin funcionalidad todavía — ver comentario arriba.
  return {
    confirmedDeposits,
    transfersReceived,
    paymentsMadeFromAccount,
    expectedBalance: confirmedDeposits + transfersReceived - paymentsMadeFromAccount,
  };
}

/** Lista de cuentas + su saldo esperado, para el Panel de Bancos (§5) — evita N+1 en el cliente. */
export async function listBankAccountsWithBalances(branchId?: string | null) {
  const accounts = await listBankAccounts(branchId);
  return Promise.all(accounts.map(async (account) => ({
    ...account,
    balance: await getBankAccountExpectedBalance(account.id),
  })));
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
    const accountsAvailable = await prisma.bankAccount.count({
      where: { isActive: true, OR: [{ branchId: input.branchId }, { branchId: null }] },
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
 * Se llama desde reviewAutoClosedCashSession (cash-session/service.ts) al
 * momento en que una caja auto-cerrada por el cron obtiene por fin un
 * countedCashAmount real (nadie contó nada al momento del auto-cierre). Todo
 * va a Retener — es la verdad física, la plata se quedó donde estaba, no
 * una intención inventada (prompt-pantallas-recorrido-dinero.md §3, "El
 * cierre automático"). declareCashDestination permite reemplazarla después
 * por la declaración real.
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
  await tx.bankAccount.updateMany({ where: { id: { in: ids } }, data: { lastUsedAt: new Date() } });
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
