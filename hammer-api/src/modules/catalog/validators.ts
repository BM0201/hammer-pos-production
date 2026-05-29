import { z } from "zod";

export const createCategorySchema = z.object({
  code: z.string().min(2).max(32),
  name: z.string().min(2).max(120),
  parentId: z.string().cuid().optional().nullable(),
});

export const updateCategorySchema = z.object({
  code: z.string().min(2).max(32).optional(),
  name: z.string().min(2).max(120).optional(),
  parentId: z.string().cuid().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const createProductSchema = z.object({
  sku: z.string().max(64).optional().nullable(),
  barcode: z.string().max(64).optional().nullable(),
  name: z.string().min(2).max(160),
  description: z.string().max(500).optional().nullable(),
  categoryId: z.string().cuid(),
  unit: z.string().min(1).max(32),
  allowsFraction: z.boolean().default(false),
  standardSalePrice: z.coerce.number().positive(),
  isTimber: z.boolean().default(false),
});

export const updateProductSchema = z.object({
  barcode: z.string().max(64).optional().nullable(),
  name: z.string().min(2).max(160).optional(),
  description: z.string().max(500).optional().nullable(),
  categoryId: z.string().cuid().optional(),
  unit: z.string().min(1).max(32).optional(),
  allowsFraction: z.boolean().optional(),
  standardSalePrice: z.coerce.number().positive().optional(),
  isActive: z.boolean().optional(),
});
