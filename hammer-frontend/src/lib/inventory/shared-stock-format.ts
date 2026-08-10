/**
 * Formateo del stock compartido de una fusión, para cualquier pantalla.
 *
 * Reemplaza a `renderSharedStock` + `ironQuintalFactor` de
 * catalog-inventory-admin.tsx, que tenían las palabras "quintal" y "varilla"
 * escritas a mano y una tabla de factores por código de grupo (1_2→8, 3_8→14,
 * 1_4→30) heredada de cuando la fusión existía solo para hierro. Sobre una
 * fusión de piedrín ese código producía "10.6 quintales" y "1 quintal = 5
 * varillas": las cifras salían del factor real, pero los sustantivos eran
 * fijos. Acá TODAS las unidades salen del grupo. Ninguna palabra de unidad
 * está escrita en este archivo.
 */
import type { ProductStockView } from "@/lib/inventory/types";

export type SharedStockDisplay = {
  primary: string;    // "2 metros"
  secondary: string;  // "Equivale a 53 latas"
  chip: string;       // "1 metro = 22 latas"
};

const fmt = (value: number) =>
  new Intl.NumberFormat("es-NI", { maximumFractionDigits: 2 }).format(value);

/** Plural simple en español, suficiente para nombres de unidad. */
function pluralize(unit: string, quantity: number): string {
  const u = unit.toLowerCase().trim();
  if (!u || Math.abs(quantity) === 1) return u;
  if (/[aeiou]$/.test(u)) return `${u}s`;
  if (/[zs]$/.test(u)) return u;
  return `${u}es`;
}

const withUnit = (quantity: number, unit: string) => `${fmt(quantity)} ${pluralize(unit, quantity)}`;

export function formatSharedStock(product: ProductStockView): SharedStockDisplay | null {
  const shared = product.sharedStock;
  const conversion = product.stockConversion;
  if (!shared || !conversion) return null;

  const saleUnit = conversion.saleUnit;
  const baseUnit = conversion.baseUnit;
  const factor = Number(conversion.conversionFactor);

  // ── Grupo con empaque cerrado/suelto ──────────────────────────────────
  if (conversion.tracksPackages && shared.packageStock) {
    const pkg = shared.packageStock;
    const packageUnit = conversion.packageUnit ?? pkg.packageUnit;
    const aprox = conversion.approximateFactor ? " aprox." : "";

    if (conversion.isPackagePresentation) {
      return {
        primary: `${withUnit(pkg.closedPackageQuantity, packageUnit)} cerrados`,
        secondary: `${withUnit(pkg.looseUnitQuantity, baseUnit)} sueltos · total ${withUnit(pkg.equivalentBaseQuantity, baseUnit)}`,
        chip: `1 ${packageUnit.toLowerCase()} = ${withUnit(pkg.conversionFactor, baseUnit)}${aprox}`,
      };
    }
    return {
      primary: withUnit(shared.saleQuantity, saleUnit),
      secondary: `${withUnit(pkg.looseUnitQuantity, baseUnit)} sueltos · ${withUnit(pkg.closedPackageQuantity, packageUnit)} cerrados · total ${withUnit(pkg.equivalentBaseQuantity, baseUnit)}`,
      chip: `1 ${packageUnit.toLowerCase()} = ${withUnit(pkg.conversionFactor, baseUnit)}${aprox}`,
    };
  }

  // ── Grupo de equivalencias puras (agregados: lata / palada / metro) ────
  return {
    primary: withUnit(shared.saleQuantity, saleUnit),
    secondary: `Equivale a ${withUnit(shared.baseQuantity, baseUnit)}`,
    chip: conversion.isCanonical
      ? `Unidad base de ${conversion.stockGroupName}`
      : `1 ${saleUnit.toLowerCase()} = ${withUnit(factor, baseUnit)}`,
  };
}
