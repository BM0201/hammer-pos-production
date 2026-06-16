import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";

export type SupplierInput = {
  name: string;
  commercialName?: string | null;
  ruc?: string | null;
  phone?: string | null;
  phone2?: string | null;
  email?: string | null;
  address?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  accountHolder?: string | null;
  paymentTerms?: string | null;
  creditLimit?: number | null;
  notes?: string | null;
  category?: string | null;
  defaultCurrency?: string | null;
  leadTimeDays?: number | null;
  preferredPaymentMethod?: string | null;
  supplierCode?: string | null;
  isActive?: boolean;
};

function clean(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function assertUniqueSupplier(input: { name?: string | null; ruc?: string | null; supplierCode?: string | null }, excludeId?: string) {
  const name = clean(input.name);
  const ruc = clean(input.ruc);
  const supplierCode = clean(input.supplierCode);
  if (!name && !ruc && !supplierCode) return;
  const existing = await prisma.supplier.findFirst({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [
        ...(name ? [{ name: { equals: name, mode: "insensitive" as const } }] : []),
        ...(ruc ? [{ ruc }] : []),
        ...(supplierCode ? [{ supplierCode }] : []),
      ],
    },
    select: { id: true, name: true, ruc: true },
  });
  if (existing) {
    throw new Error("VALIDATION_ERROR: Ya existe un proveedor con ese nombre, RUC o codigo.");
  }
}

function supplierData(input: SupplierInput): Prisma.SupplierUncheckedCreateInput {
  return {
    name: clean(input.name) ?? "",
    commercialName: clean(input.commercialName),
    ruc: clean(input.ruc),
    phone: clean(input.phone),
    phone2: clean(input.phone2),
    email: clean(input.email),
    address: clean(input.address),
    contactName: clean(input.contactName),
    contactPhone: clean(input.contactPhone),
    bankName: clean(input.bankName),
    bankAccountNumber: clean(input.bankAccountNumber),
    accountHolder: clean(input.accountHolder),
    paymentTerms: clean(input.paymentTerms),
    creditLimit: input.creditLimit === null || input.creditLimit === undefined ? null : new Prisma.Decimal(input.creditLimit),
    notes: clean(input.notes),
    category: clean(input.category),
    defaultCurrency: clean(input.defaultCurrency),
    leadTimeDays: input.leadTimeDays ?? null,
    preferredPaymentMethod: clean(input.preferredPaymentMethod),
    supplierCode: clean(input.supplierCode),
    isActive: input.isActive ?? true,
  };
}

export async function listSuppliers(params?: { q?: string; includeInactive?: boolean }) {
  const q = clean(params?.q);
  return prisma.supplier.findMany({
    where: {
      ...(params?.includeInactive ? {} : { isActive: true }),
      ...(q ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { commercialName: { contains: q, mode: "insensitive" } },
          { ruc: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
        ],
      } : {}),
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: 100,
  });
}

export async function getSupplier(id: string) {
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) throw new Error("NOT_FOUND");
  return supplier;
}

export async function createSupplier(input: SupplierInput, actorUserId: string) {
  if (!clean(input.name)) throw new Error("VALIDATION_ERROR: El nombre del proveedor es obligatorio.");
  await assertUniqueSupplier(input);
  const supplier = await prisma.supplier.create({ data: supplierData(input) });
  await logAuditEvent({
    actorUserId,
    module: "suppliers",
    action: "SUPPLIER_CREATED",
    entityType: "Supplier",
    entityId: supplier.id,
    metadataJson: { supplierId: supplier.id, name: supplier.name, ruc: supplier.ruc },
  });
  return supplier;
}

export async function updateSupplier(id: string, input: Partial<SupplierInput>, actorUserId: string) {
  const current = await prisma.supplier.findUnique({ where: { id } });
  if (!current) throw new Error("NOT_FOUND");
  await assertUniqueSupplier({
    name: input.name ?? current.name,
    ruc: input.ruc ?? current.ruc,
    supplierCode: input.supplierCode ?? current.supplierCode,
  }, id);
  const data = supplierData({
    name: input.name ?? current.name,
    commercialName: input.commercialName ?? current.commercialName,
    ruc: input.ruc ?? current.ruc,
    phone: input.phone ?? current.phone,
    phone2: input.phone2 ?? current.phone2,
    email: input.email ?? current.email,
    address: input.address ?? current.address,
    contactName: input.contactName ?? current.contactName,
    contactPhone: input.contactPhone ?? current.contactPhone,
    bankName: input.bankName ?? current.bankName,
    bankAccountNumber: input.bankAccountNumber ?? current.bankAccountNumber,
    accountHolder: input.accountHolder ?? current.accountHolder,
    paymentTerms: input.paymentTerms ?? current.paymentTerms,
    creditLimit: input.creditLimit ?? (current.creditLimit === null ? null : Number(current.creditLimit)),
    notes: input.notes ?? current.notes,
    category: input.category ?? current.category,
    defaultCurrency: input.defaultCurrency ?? current.defaultCurrency,
    leadTimeDays: input.leadTimeDays ?? current.leadTimeDays,
    preferredPaymentMethod: input.preferredPaymentMethod ?? current.preferredPaymentMethod,
    supplierCode: input.supplierCode ?? current.supplierCode,
    isActive: input.isActive ?? current.isActive,
  });
  const supplier = await prisma.supplier.update({ where: { id }, data });
  await logAuditEvent({
    actorUserId,
    module: "suppliers",
    action: "SUPPLIER_UPDATED",
    entityType: "Supplier",
    entityId: supplier.id,
    metadataJson: { previous: current, current: supplier },
  });
  return supplier;
}

export async function disableSupplier(id: string, actorUserId: string) {
  const current = await prisma.supplier.findUnique({ where: { id } });
  if (!current) throw new Error("NOT_FOUND");
  const supplier = await prisma.supplier.update({ where: { id }, data: { isActive: false } });
  await logAuditEvent({
    actorUserId,
    module: "suppliers",
    action: "SUPPLIER_UPDATED",
    entityType: "Supplier",
    entityId: supplier.id,
    metadataJson: { previous: { isActive: current.isActive }, current: { isActive: false } },
  });
  return supplier;
}
