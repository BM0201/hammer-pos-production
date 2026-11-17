/** Viajes de madera: numeración, borrador (crear/editar), cancelar, ver y listar. Ingresar vive en injection.ts. */
import { prisma } from "@/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { calculateTimberTrip, calculateReconciliation, type TimberPricing, type TimberTripLineInput } from "./calculator";
import type { CreateTimberTripInput, UpdateTimberTripInput } from "./validators";
import { getPricingConfig } from "./pricing-config";

/* ══════════════════════════════════════════════════════════
   Timber Trips (Viajes de Madera)
   ══════════════════════════════════════════════════════════ */

/** Código de trabajo de un viaje sin número: BOR = borrador, CAN = cancelado. Solo el ingreso consume correlativo. */
function provisionalTripCode(prefix: "BOR" | "CAN"): string {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

/** Año de Managua: el servidor corre en UTC y el 31/12 por la noche ya sería el año siguiente. */
export function tripCodePrefix(at: Date = new Date()): string {
  const year = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Managua", year: "numeric" }).format(at);
  return `VJM-${year}-`;
}

/** Comparación numérica: como texto, "VJM-2026-1000" ordena antes que "VJM-2026-999". */
export function nextTripCodeFrom(prefix: string, confirmedCodes: string[]): string {
  const last = confirmedCodes.reduce((max, code) => {
    const number = code.startsWith(prefix) ? Number(code.slice(prefix.length)) : 0;
    return Number.isInteger(number) && number > max ? number : max;
  }, 0);
  return `${prefix}${String(last + 1).padStart(3, "0")}`;
}

/** Número que saldría si se ingresa un viaje ahora: el siguiente a los YA ingresados. Cancelados y borradores no cuentan. */
async function getNextTripCode(client: Pick<Prisma.TransactionClient, "timberTrip"> = prisma): Promise<string> {
  const prefix = tripCodePrefix();
  const confirmed = await client.timberTrip.findMany({
    where: { tripCode: { startsWith: prefix }, status: { in: ["CONFIRMED", "TRANSFERRED"] } },
    select: { tripCode: true },
  });
  return nextTripCodeFrom(prefix, confirmed.map((trip) => trip.tripCode));
}

/**
 * Asigna el número definitivo dentro de la transacción de confirmar. El candado serializa dos
 * ingresos simultáneos (dos borradores abiertos no pueden sacar el mismo número). Si el número
 * lo tiene un viaje viejo sin ingresar (antes se numeraba al crear), ese viaje lo cede.
 */
export async function assignTripCodeTx(tx: Prisma.TransactionClient, tripId: string): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('timber_trip_code'))`;
  const tripCode = await getNextTripCode(tx);
  const holder = await tx.timberTrip.findUnique({ where: { tripCode }, select: { id: true, status: true } });
  if (holder && holder.id !== tripId) {
    await tx.timberTrip.update({
      where: { id: holder.id },
      data: { tripCode: provisionalTripCode(holder.status === "CANCELLED" ? "CAN" : "BOR") },
    });
  }
  await tx.timberTrip.update({ where: { id: tripId }, data: { tripCode } });
  return tripCode;
}

/** Create a new timber trip with lines */
export async function createTimberTrip(input: CreateTimberTripInput, userId?: string) {
  const pricing = await getPricingConfig(input.destinationBranchId);
  const tripPricing: TimberPricing = {
    costPerFoot: pricing.costPerFoot,
    pricePerInchTabla: input.pricePerInchTabla ?? pricing.pricePerInchTabla,
    pricePerInchTablilla: input.pricePerInchTablilla ?? pricing.pricePerInchTablilla,
    pricePerInchCuadro: input.pricePerInchCuadro ?? pricing.pricePerInchCuadro,
  };

  // Calculate trip
  const tripLines: TimberTripLineInput[] = input.lines.map((l) => ({
    thickness: l.thickness,
    width: l.width,
    length: l.length,
    pieces: l.pieces,
    priceGroup: l.priceGroup,
  }));

  const calc = calculateTimberTrip(tripLines, input.woodTripTotalCost, tripPricing, {
    costPerFootInput: input.costPerFoot,
    expenses: input.expenses,
    targetMarginPercent: pricing.targetMarginPercent,
    classification: pricing.classification,
  });

  const trip = await prisma.$transaction(async (tx) => {
    const newTrip = await tx.timberTrip.create({
      data: {
        tripCode: provisionalTripCode("BOR"),
        destinationBranchId: input.destinationBranchId,
        status: "DRAFT",
        woodTripTotalCost: new Decimal(calc.totals.woodTripTotalCost),
        computedCostPerFoot: new Decimal(calc.totals.computedCostPerFoot),
        freightAmount: new Decimal(input.expenses?.freightAmount ?? 0),
        fuelAmount: new Decimal(input.expenses?.fuelAmount ?? 0),
        perDiemAmount: new Decimal(input.expenses?.perDiemAmount ?? 0),
        permitsAmount: new Decimal(input.expenses?.permitsAmount ?? 0),
        otherExpensesAmount: new Decimal(input.expenses?.otherExpensesAmount ?? 0),
        sawingAmount: new Decimal(input.expenses?.sawingAmount ?? 0),
        tripExpensesTotal: new Decimal(calc.totals.tripExpensesTotal),
        landedCostPerFoot: new Decimal(calc.totals.landedCostPerFoot),
        invoicedFeet: input.invoicedFeet != null ? new Decimal(input.invoicedFeet) : null,
        pricePolicy: input.pricePolicy ?? "RECALC_FROM_PRICE_PER_INCH",
        pricePerInchTabla: new Decimal(tripPricing.pricePerInchTabla),
        pricePerInchTablilla: new Decimal(tripPricing.pricePerInchTablilla),
        pricePerInchCuadro: new Decimal(tripPricing.pricePerInchCuadro),
        totalPieces: calc.totals.totalPieces,
        totalFeet: new Decimal(calc.totals.totalFeet),
        totalCost: new Decimal(calc.totals.totalCostFeet),
        totalSale: new Decimal(calc.totals.totalSale),
        totalProfit: new Decimal(calc.totals.totalProfit),
        marginPercent: new Decimal(calc.totals.globalMarginPct),
        supplierName: input.supplierName,
        origin: input.origin,
        notes: input.notes,
        createdById: userId,
        lines: {
          create: calc.lines.map((line) => ({
            thicknessIn: line.dimensions.thickness,
            widthIn: line.dimensions.width,
            lengthIn: line.dimensions.length,
            varaLength: line.varaLength,
            priceGroup: line.priceGroup,
            pieces: line.pieces,
            calculatedFeet: new Decimal(line.calculatedFeet),
            calculatedCostFeet: new Decimal(line.calculatedCostFeet),
            calculatedCostPerPiece: new Decimal(line.calculatedCostPerPiece),
            calculatedSalePricePerPiece: new Decimal(line.calculatedSalePricePerPiece),
            calculatedSaleTotal: new Decimal(line.calculatedSaleTotal),
            calculatedProfit: new Decimal(line.calculatedProfit),
            calculatedMarginPct: new Decimal(line.calculatedMarginPct),
          })),
        },
      },
      include: { lines: true, destinationBranch: true },
    });

    return newTrip;
  });

  return { trip, calculation: calc };
}

/** Update a draft timber trip */
export async function updateTimberTrip(id: string, input: UpdateTimberTripInput) {
  const existing = await prisma.timberTrip.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!existing) throw new Error("TIMBER_TRIP_NOT_FOUND");
  if (existing.status !== "DRAFT") throw new Error("TRIP_NOT_EDITABLE");

  const pricing = await getPricingConfig(existing.destinationBranchId);
  const tripPricing: TimberPricing = {
    costPerFoot: pricing.costPerFoot,
    pricePerInchTabla: input.pricePerInchTabla ?? existing.pricePerInchTabla.toNumber(),
    pricePerInchTablilla: input.pricePerInchTablilla ?? existing.pricePerInchTablilla.toNumber(),
    pricePerInchCuadro: input.pricePerInchCuadro ?? existing.pricePerInchCuadro.toNumber(),
  };

  const woodCost = input.woodTripTotalCost ?? existing.woodTripTotalCost.toNumber();
  const lines = input.lines ?? existing.lines.map((l) => ({
    thickness: l.thicknessIn,
    width: l.widthIn,
    length: l.lengthIn,
    pieces: l.pieces,
    priceGroup: l.priceGroup as "TABLA" | "TABLILLA" | "CUADRO",
  }));
  const expenses = input.expenses ?? {
    freightAmount: existing.freightAmount.toNumber(),
    fuelAmount: existing.fuelAmount.toNumber(),
    perDiemAmount: existing.perDiemAmount.toNumber(),
    permitsAmount: existing.permitsAmount.toNumber(),
    otherExpensesAmount: existing.otherExpensesAmount.toNumber(),
    sawingAmount: existing.sawingAmount.toNumber(),
  };

  const calc = calculateTimberTrip(
    lines.map((l) => ({
      thickness: l.thickness,
      width: l.width,
      length: l.length,
      pieces: l.pieces,
      priceGroup: l.priceGroup,
    })),
    woodCost,
    tripPricing,
    { costPerFootInput: input.costPerFoot, expenses, targetMarginPercent: pricing.targetMarginPercent, classification: pricing.classification },
  );

  const trip = await prisma.$transaction(async (tx) => {
    // El chequeo de DRAFT de arriba es fuera de la transacción: un
    // autoguardado que llega justo después de confirmar reemplazaba las
    // líneas y totales de un viaje ya inyectado. Candado + rechequeo acá.
    await tx.$queryRaw`SELECT id FROM "TimberTrip" WHERE id = ${id} FOR UPDATE`;
    const locked = await tx.timberTrip.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (locked.status !== "DRAFT") throw new Error("TRIP_NOT_EDITABLE");

    // Delete old lines
    await tx.timberTripLine.deleteMany({ where: { tripId: id } });

    // Update trip
    return tx.timberTrip.update({
      where: { id },
      data: {
        woodTripTotalCost: new Decimal(calc.totals.woodTripTotalCost),
        computedCostPerFoot: new Decimal(calc.totals.computedCostPerFoot),
        freightAmount: new Decimal(expenses.freightAmount ?? 0),
        fuelAmount: new Decimal(expenses.fuelAmount ?? 0),
        perDiemAmount: new Decimal(expenses.perDiemAmount ?? 0),
        permitsAmount: new Decimal(expenses.permitsAmount ?? 0),
        otherExpensesAmount: new Decimal(expenses.otherExpensesAmount ?? 0),
        sawingAmount: new Decimal(expenses.sawingAmount ?? 0),
        tripExpensesTotal: new Decimal(calc.totals.tripExpensesTotal),
        landedCostPerFoot: new Decimal(calc.totals.landedCostPerFoot),
        invoicedFeet: input.invoicedFeet !== undefined ? (input.invoicedFeet != null ? new Decimal(input.invoicedFeet) : null) : undefined,
        pricePolicy: input.pricePolicy ?? undefined,
        pricePerInchTabla: new Decimal(tripPricing.pricePerInchTabla),
        pricePerInchTablilla: new Decimal(tripPricing.pricePerInchTablilla),
        pricePerInchCuadro: new Decimal(tripPricing.pricePerInchCuadro),
        totalPieces: calc.totals.totalPieces,
        totalFeet: new Decimal(calc.totals.totalFeet),
        totalCost: new Decimal(calc.totals.totalCostFeet),
        totalSale: new Decimal(calc.totals.totalSale),
        totalProfit: new Decimal(calc.totals.totalProfit),
        marginPercent: new Decimal(calc.totals.globalMarginPct),
        supplierName: input.supplierName !== undefined ? input.supplierName : undefined,
        origin: input.origin !== undefined ? input.origin : undefined,
        notes: input.notes !== undefined ? input.notes : undefined,
        lines: {
          create: calc.lines.map((line) => ({
            thicknessIn: line.dimensions.thickness,
            widthIn: line.dimensions.width,
            lengthIn: line.dimensions.length,
            varaLength: line.varaLength,
            priceGroup: line.priceGroup,
            pieces: line.pieces,
            calculatedFeet: new Decimal(line.calculatedFeet),
            calculatedCostFeet: new Decimal(line.calculatedCostFeet),
            calculatedCostPerPiece: new Decimal(line.calculatedCostPerPiece),
            calculatedSalePricePerPiece: new Decimal(line.calculatedSalePricePerPiece),
            calculatedSaleTotal: new Decimal(line.calculatedSaleTotal),
            calculatedProfit: new Decimal(line.calculatedProfit),
            calculatedMarginPct: new Decimal(line.calculatedMarginPct),
          })),
        },
      },
      include: { lines: true, destinationBranch: true },
    });
  });

  // BUG FIX (crash en produccion): getTimberTrip adjunta `reconciliation` al
  // trip que devuelve, pero este endpoint (el que dispara el autoguardado
  // con debounce del frontend) devolvia el trip crudo de Prisma sin ese
  // campo. El frontend lee `trip.reconciliation.status` incondicionalmente
  // (StepViajeYCubicacion/StepConfirmar) — apenas el autoguardado reemplazaba
  // el trip en el estado, la siguiente renderizacion crasheaba con
  // "Cannot read properties of undefined (reading 'status')". Mismo calculo
  // que getTimberTrip, reutilizando el `pricing` ya cargado arriba.
  const reconciliation = calculateReconciliation(
    trip.totalFeet.toNumber(),
    trip.invoicedFeet != null ? trip.invoicedFeet.toNumber() : null,
    pricing.reconciliationTolerancePercent,
  );

  return { trip: { ...trip, reconciliation }, calculation: calc };
}

/** Cancel a timber trip */
export async function cancelTimberTrip(id: string) {
  const trip = await prisma.timberTrip.findUnique({ where: { id } });
  if (!trip) throw new Error("TIMBER_TRIP_NOT_FOUND");
  if (trip.status === "TRANSFERRED" || trip.status === "CANCELLED") {
    throw new Error("TRIP_CANNOT_BE_CANCELLED");
  }

  // Condicionado al estado: si un confirmar entró en medio (ya TRANSFERRED),
  // no se marca cancelado un viaje que ya está en inventario.
  const transition = await prisma.timberTrip.updateMany({
    where: { id, status: { notIn: ["TRANSFERRED", "CANCELLED"] } },
    data: { status: "CANCELLED" },
  });
  if (transition.count === 0) throw new Error("TRIP_CANNOT_BE_CANCELLED");
  const cancelled = await prisma.timberTrip.findUniqueOrThrow({
    where: { id },
    include: { lines: true, destinationBranch: true },
  });

  // Mismo shape que getTimberTrip/updateTimberTrip/confirmTimberTrip.
  const config = await getPricingConfig(cancelled.destinationBranchId);
  const reconciliation = calculateReconciliation(
    cancelled.totalFeet.toNumber(),
    cancelled.invoicedFeet != null ? cancelled.invoicedFeet.toNumber() : null,
    config.reconciliationTolerancePercent,
  );
  return { ...cancelled, reconciliation };
}

/** Get a single trip with lines */
export async function getTimberTrip(id: string) {
  const trip = await prisma.timberTrip.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { createdAt: "asc" } },
      destinationBranch: true,
    },
  });
  if (!trip) return null;

  const config = await getPricingConfig(trip.destinationBranchId);
  const reconciliation = calculateReconciliation(
    trip.totalFeet.toNumber(),
    trip.invoicedFeet != null ? trip.invoicedFeet.toNumber() : null,
    config.reconciliationTolerancePercent,
  );

  return { ...trip, reconciliation, nextTripCode: trip.status === "DRAFT" ? await getNextTripCode() : null };
}

/** List timber trips with filtering */
export async function listTimberTrips(filters?: {
  status?: string;
  destinationBranchId?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (filters?.status) {
    where.status = filters.status;
  } else {
    // prompt-timber-borrador-bugs.md, BUG 1 — sin un status pedido
    // explícito, la lista activa no debe ensuciarse con viajes
    // cancelados (ahora se pueden cancelar desde la interfaz). Quien
    // necesite verlos igual puede pedir status=CANCELLED explícito.
    where.status = { not: "CANCELLED" };
  }
  if (filters?.destinationBranchId) where.destinationBranchId = filters.destinationBranchId;
  if (filters?.search) {
    where.OR = [
      { tripCode: { contains: filters.search, mode: "insensitive" } },
      { supplierName: { contains: filters.search, mode: "insensitive" } },
      { origin: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const [items, total, nextTripCode] = await Promise.all([
    prisma.timberTrip.findMany({
      where,
      include: {
        destinationBranch: true,
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.timberTrip.count({ where }),
    getNextTripCode(),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit), nextTripCode };
}
