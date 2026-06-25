"use client";

import { useCallback, useState } from "react";
import type { CachedProduct, OfflineSaleLine } from "@/lib/offline-db";

export type OfflineCartLine = OfflineSaleLine & { lineId: string };

export function useOfflineCart() {
  const [lines, setLines] = useState<OfflineCartLine[]>([]);
  const [notes, setNotes] = useState("");

  const addProduct = useCallback((product: CachedProduct, qty = 1) => {
    setLines(prev => {
      const existing = prev.find(l => l.productId === product.id);
      if (existing) {
        const newQty = existing.quantity + qty;
        return prev.map(l =>
          l.productId === product.id
            ? { ...l, quantity: newQty, lineSubtotal: newQty * l.unitPrice }
            : l,
        );
      }
      const price = product.effectivePrice;
      return [...prev, {
        lineId: `${product.id}-${Date.now()}`,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: qty,
        unitPrice: price,
        discountAmount: 0,
        lineSubtotal: qty * price,
      }];
    });
  }, []);

  const updateQuantity = useCallback((lineId: string, qty: number) => {
    if (qty <= 0) {
      setLines(prev => prev.filter(l => l.lineId !== lineId));
      return;
    }
    setLines(prev =>
      prev.map(l => l.lineId === lineId
        ? { ...l, quantity: qty, lineSubtotal: qty * l.unitPrice }
        : l),
    );
  }, []);

  const removeLine = useCallback((lineId: string) => {
    setLines(prev => prev.filter(l => l.lineId !== lineId));
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setNotes("");
  }, []);

  const grandTotal = lines.reduce((s, l) => s + l.lineSubtotal, 0);

  return { lines, notes, setNotes, addProduct, updateQuantity, removeLine, clear, grandTotal };
}
