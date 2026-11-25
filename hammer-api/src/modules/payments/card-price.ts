import { PaymentMethod, Prisma } from "@prisma/client";

/**
 * Los precios ya traen un 6% de descuento de contado. Con tarjeta el cliente
 * pierde ese descuento: C$440 → C$466.40; el banco luego cobra su 6% sobre lo
 * pasado por el datáfono y quedan ~C$438.42, casi el precio de contado.
 */
export const CARD_PRICE_RATE = new Prisma.Decimal("0.06");

/**
 * Sube cada línea de tarjeta al precio sin descuento de contado. `extra` es lo
 * que se suma al total de la orden (cardPriceAmount). Pura.
 */
export function applyCardPrice<T extends { method: PaymentMethod; amount: number }>(tenders: readonly T[]) {
  let extra = new Prisma.Decimal(0);
  const charged = tenders.map((tender) => {
    if (tender.method !== PaymentMethod.CARD) return tender;
    const base = new Prisma.Decimal(tender.amount);
    const add = base.mul(CARD_PRICE_RATE).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    extra = extra.add(add);
    return { ...tender, amount: base.add(add).toNumber() };
  });
  return { tenders: charged, extra };
}
