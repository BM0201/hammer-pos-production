import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";

type AllocationMethod = "BY_VALUE" | "BY_QUANTITY" | "MANUAL";

type TripLineInput = {
  productId: string;
  transferLineId?: string | null;
  quantity: number;
  lineValue: number;
  allocatedFreight?: number;
};

type CreateTripInput = {
  routeId: string;
  transferId?: string | null;
  truckId?: string | null;
  tripDate?: string | null;
  fuelPricePerGallon: number;
  fuelCost?: number | null;
  driverCost?: number | null;
  helperCost?: number | null;
  otherCost?: number | null;
  allocationMethod?: string | null;
  notes?: string | null;
  lines?: TripLineInput[];
};

function n(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegative(value: unknown, field: string, fallback = 0) {
  const parsed = n(value, fallback);
  if (parsed < 0) throw new Error(`INVALID_INPUT: ${field} no puede ser negativo`);
  return parsed;
}

function decimal(value: number) {
  return new Prisma.Decimal(Math.round(value * 10000) / 10000);
}

function normalizeAllocationMethod(value?: string | null): AllocationMethod {
  return value === "BY_QUANTITY" || value === "MANUAL" ? value : "BY_VALUE";
}

export async function listInternalFreightRoutes() {
  return prisma.internalFreightRoute.findMany({
    include: {
      originBranch: { select: { id: true, code: true, name: true } },
      destinationBranch: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

export async function createInternalFreightRoute(input: {
  originBranchId: string;
  destinationBranchId: string;
  name: string;
  roundTripKm: number;
  defaultAllocationMethod?: string;
  notes?: string | null;
}, actorUserId?: string) {
  if (!input.originBranchId || !input.destinationBranchId) throw new Error("INVALID_INPUT: origen y destino son requeridos");
  if (input.originBranchId === input.destinationBranchId) throw new Error("INVALID_INPUT: origen y destino no pueden ser iguales");
  const roundTripKm = nonNegative(input.roundTripKm, "roundTripKm");
  if (roundTripKm <= 0) throw new Error("INVALID_INPUT: km ida/vuelta debe ser mayor a 0");

  const route = await prisma.internalFreightRoute.create({
    data: {
      originBranchId: input.originBranchId,
      destinationBranchId: input.destinationBranchId,
      name: input.name.trim(),
      roundTripKm: decimal(roundTripKm),
      defaultAllocationMethod: normalizeAllocationMethod(input.defaultAllocationMethod),
      notes: input.notes?.trim() || null,
    },
    include: {
      originBranch: { select: { id: true, code: true, name: true } },
      destinationBranch: { select: { id: true, code: true, name: true } },
    },
  });

  await logAuditEvent({
    actorUserId,
    branchId: input.originBranchId,
    module: "internal-freight",
    action: "route.created",
    entityType: "InternalFreightRoute",
    entityId: route.id,
    metadataJson: { destinationBranchId: input.destinationBranchId, roundTripKm },
  });

  return route;
}

export async function listTrucks() {
  return prisma.truck.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] });
}

export async function createTruck(input: {
  name: string;
  plate?: string | null;
  fuelEfficiencyKmPerGallon?: number | null;
  maintenanceCostPerKm?: number | null;
  notes?: string | null;
}, actorUserId?: string) {
  if (!input.name?.trim()) throw new Error("INVALID_INPUT: nombre del camion es requerido");
  const fuelEfficiency = input.fuelEfficiencyKmPerGallon == null ? null : nonNegative(input.fuelEfficiencyKmPerGallon, "fuelEfficiencyKmPerGallon");
  const maintenance = nonNegative(input.maintenanceCostPerKm, "maintenanceCostPerKm");

  const truck = await prisma.truck.create({
    data: {
      name: input.name.trim(),
      plate: input.plate?.trim() || null,
      fuelEfficiencyKmPerGallon: fuelEfficiency && fuelEfficiency > 0 ? decimal(fuelEfficiency) : null,
      maintenanceCostPerKm: decimal(maintenance),
      notes: input.notes?.trim() || null,
    },
  });

  await logAuditEvent({
    actorUserId,
    module: "internal-freight",
    action: "truck.created",
    entityType: "Truck",
    entityId: truck.id,
    metadataJson: { plate: truck.plate },
  });

  return truck;
}

async function buildLinesFromTransfer(transferId: string, route: { originBranchId: string; destinationBranchId: string }) {
  const transfer = await prisma.transfer.findUnique({
    where: { id: transferId },
    include: {
      lines: { include: { product: true } },
    },
  });
  if (!transfer) throw new Error("TRANSFER_NOT_FOUND");
  if (transfer.fromBranchId !== route.originBranchId || transfer.toBranchId !== route.destinationBranchId) {
    throw new Error("INVALID_INPUT: La transferencia no coincide con la ruta seleccionada");
  }

  return transfer.lines
    .filter((line) => line.product.isActive && !line.product.isTimber)
    .map((line) => {
      const quantity = Number(line.quantityReceived) > 0 ? Number(line.quantityReceived) : Number(line.quantityRequested);
      const unitCost = Number(line.unitCostSnapshot);
      return {
        productId: line.productId,
        transferLineId: line.id,
        quantity,
        lineValue: quantity * unitCost,
      };
    });
}

function allocateLines(lines: TripLineInput[], totalTripCost: number, method: AllocationMethod) {
  if (!lines.length) throw new Error("INVALID_INPUT: Debe agregar al menos una linea al viaje");
  const safeLines = lines.map((line) => ({
    ...line,
    quantity: nonNegative(line.quantity, "quantity"),
    lineValue: nonNegative(line.lineValue, "lineValue"),
    allocatedFreight: line.allocatedFreight == null ? undefined : nonNegative(line.allocatedFreight, "allocatedFreight"),
  }));

  if (method === "BY_QUANTITY") {
    const totalQuantity = safeLines.reduce((sum, line) => sum + line.quantity, 0);
    if (totalQuantity <= 0) throw new Error("INVALID_INPUT: Cantidad total debe ser mayor a 0");
    return safeLines.map((line) => {
      const allocatedFreight = totalTripCost * (line.quantity / totalQuantity);
      return { ...line, allocatedFreight, allocatedFreightPerUnit: line.quantity > 0 ? allocatedFreight / line.quantity : 0 };
    });
  }

  if (method === "MANUAL") {
    const allocatedTotal = safeLines.reduce((sum, line) => sum + (line.allocatedFreight ?? 0), 0);
    if (Math.abs(allocatedTotal - totalTripCost) > 0.05) {
      throw new Error("INVALID_INPUT: La suma manual de flete debe cuadrar con el total del viaje");
    }
    return safeLines.map((line) => ({
      ...line,
      allocatedFreight: line.allocatedFreight ?? 0,
      allocatedFreightPerUnit: line.quantity > 0 ? (line.allocatedFreight ?? 0) / line.quantity : 0,
    }));
  }

  const totalValue = safeLines.reduce((sum, line) => sum + line.lineValue, 0);
  if (totalValue <= 0) throw new Error("INVALID_INPUT: Valor total debe ser mayor a 0");
  return safeLines.map((line) => {
    const allocatedFreight = totalTripCost * (line.lineValue / totalValue);
    return { ...line, allocatedFreight, allocatedFreightPerUnit: line.quantity > 0 ? allocatedFreight / line.quantity : 0 };
  });
}

export async function calculateInternalFreightTrip(input: CreateTripInput, actorUserId?: string) {
  const route = await prisma.internalFreightRoute.findUnique({ where: { id: input.routeId } });
  if (!route || !route.isActive) throw new Error("INTERNAL_FREIGHT_ROUTE_NOT_FOUND");

  const truck = input.truckId ? await prisma.truck.findUnique({ where: { id: input.truckId } }) : null;
  const fuelPrice = nonNegative(input.fuelPricePerGallon, "fuelPricePerGallon");
  const driverCost = nonNegative(input.driverCost, "driverCost");
  const helperCost = nonNegative(input.helperCost, "helperCost");
  const otherCost = nonNegative(input.otherCost, "otherCost");
  const roundTripKm = Number(route.roundTripKm);
  const efficiency = truck?.fuelEfficiencyKmPerGallon ? Number(truck.fuelEfficiencyKmPerGallon) : 0;
  const fuelCost = efficiency > 0
    ? (roundTripKm / efficiency) * fuelPrice
    : nonNegative(input.fuelCost, "fuelCost");
  const maintenanceCost = truck ? roundTripKm * Number(truck.maintenanceCostPerKm) : 0;
  const totalTripCost = fuelCost + maintenanceCost + driverCost + helperCost + otherCost;
  if (totalTripCost < 0) throw new Error("INVALID_INPUT: totalTripCost no puede ser negativo");

  const allocationMethod = normalizeAllocationMethod(input.allocationMethod ?? route.defaultAllocationMethod);
  const baseLines = input.transferId
    ? await buildLinesFromTransfer(input.transferId, route)
    : (input.lines ?? []);
  const allocatedLines = allocateLines(baseLines, totalTripCost, allocationMethod);

  const trip = await prisma.internalFreightTrip.create({
    data: {
      routeId: input.routeId,
      transferId: input.transferId || null,
      truckId: input.truckId || null,
      tripDate: input.tripDate ? new Date(input.tripDate) : new Date(),
      fuelPricePerGallon: decimal(fuelPrice),
      fuelCost: decimal(fuelCost),
      maintenanceCost: decimal(maintenanceCost),
      driverCost: decimal(driverCost),
      helperCost: decimal(helperCost),
      otherCost: decimal(otherCost),
      totalTripCost: decimal(totalTripCost),
      allocationMethod,
      status: "CALCULATED",
      notes: input.notes?.trim() || null,
      lines: {
        create: allocatedLines.map((line) => ({
          productId: line.productId,
          transferLineId: line.transferLineId || null,
          quantity: decimal(line.quantity),
          lineValue: decimal(line.lineValue),
          allocatedFreight: decimal(line.allocatedFreight),
          allocatedFreightPerUnit: decimal(line.allocatedFreightPerUnit),
        })),
      },
    },
    include: internalFreightTripInclude,
  });

  await logAuditEvent({
    actorUserId,
    branchId: route.originBranchId,
    module: "internal-freight",
    action: "trip.calculated",
    entityType: "InternalFreightTrip",
    entityId: trip.id,
    metadataJson: { totalTripCost, allocationMethod, transferId: input.transferId ?? null },
  });

  return trip;
}

const internalFreightTripInclude = {
  route: {
    include: {
      originBranch: { select: { id: true, code: true, name: true } },
      destinationBranch: { select: { id: true, code: true, name: true } },
    },
  },
  truck: true,
  transfer: { select: { id: true, transferNumber: true } },
  lines: {
    include: {
      product: { select: { id: true, sku: true, name: true, isTimber: true, standardSalePrice: true } },
      transferLine: { select: { id: true, unitCostSnapshot: true } },
    },
  },
} satisfies Prisma.InternalFreightTripInclude;

export async function listInternalFreightTrips() {
  return prisma.internalFreightTrip.findMany({
    include: internalFreightTripInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getInternalFreightTrip(id: string) {
  const trip = await prisma.internalFreightTrip.findUnique({ where: { id }, include: internalFreightTripInclude });
  if (!trip) throw new Error("INTERNAL_FREIGHT_TRIP_NOT_FOUND");
  return trip;
}

export async function applyInternalFreightTrip(id: string, actorUserId?: string) {
  const trip = await prisma.internalFreightTrip.findUnique({
    where: { id },
    include: internalFreightTripInclude,
  });
  if (!trip) throw new Error("INTERNAL_FREIGHT_TRIP_NOT_FOUND");
  if (trip.status === "APPLIED") return { trip, applied: false, alreadyApplied: true };
  if (!["DRAFT", "CALCULATED"].includes(trip.status)) {
    throw new Error("INVALID_INPUT: Solo se pueden aplicar viajes calculados");
  }

  const destinationBranchId = trip.route.destinationBranchId;
  const result = await prisma.$transaction(async (tx) => {
    for (const line of trip.lines) {
      if (line.product.isTimber) continue;
      const quantity = Number(line.quantity);
      if (quantity <= 0) continue;
      const baseCost = Number(line.lineValue) / quantity;
      const newBranchCost = baseCost + Number(line.allocatedFreightPerUnit);

      await tx.branchProductSetting.upsert({
        where: { branchId_productId: { branchId: destinationBranchId, productId: line.productId } },
        create: {
          branchId: destinationBranchId,
          productId: line.productId,
          branchCost: decimal(newBranchCost),
        },
        update: {
          branchCost: decimal(newBranchCost),
        },
      });

      const pricingConfig = await tx.pricingConfig.findUnique({ where: { branchId: destinationBranchId } });
      const marginPercent = pricingConfig ? Number(pricingConfig.desiredMarginPercent) : 30;
      const divisor = Math.max(0.01, 1 - marginPercent / 100);
      const suggestedPrice = newBranchCost / divisor;

      await tx.productPricing.create({
        data: {
          productId: line.productId,
          branchId: destinationBranchId,
          purchaseCost: decimal(newBranchCost),
          operatingExpensePerUnit: decimal(0),
          totalCostPerUnit: decimal(newBranchCost),
          marginPercent: decimal(marginPercent),
          suggestedPrice: decimal(suggestedPrice),
          totalMonthlyExpenses: decimal(0),
          estimatedMonthlyUnits: decimal(0),
          calculatedByUserId: actorUserId ?? null,
          notes: `Flete interno ${trip.route.name} - viaje ${trip.id}`,
        },
      });
    }

    const updated = await tx.internalFreightTrip.update({
      where: { id },
      data: { status: "APPLIED" },
      include: internalFreightTripInclude,
    });
    return updated;
  });

  await logAuditEvent({
    actorUserId,
    branchId: destinationBranchId,
    module: "internal-freight",
    action: "trip.applied",
    entityType: "InternalFreightTrip",
    entityId: id,
    metadataJson: { destinationBranchId, totalTripCost: trip.totalTripCost.toString() },
  });

  return { trip: result, applied: true, alreadyApplied: false };
}
