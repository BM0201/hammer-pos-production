"use client";

/**
 * POS Mobile Layout — Tabs para Productos / Ticket / Cobro
 * FASE 4 — H.A.M.M.E.R. POS/ERP
 */

import { useState } from "react";

type MobileTab = "products" | "ticket" | "payment";

type PosMobileLayoutProps = {
  catalogPanel: React.ReactNode;
  ticketPanel: React.ReactNode;
  paymentPanel: React.ReactNode;
  itemCount: number;
};

export function PosMobileLayout({
  catalogPanel,
  ticketPanel,
  paymentPanel,
  itemCount,
}: PosMobileLayoutProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>("products");

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="pos-mobile-tabs flex bg-[var(--color-surface)] border-b border-[var(--color-border)] sticky top-0 z-10">
        <button
          onClick={() => setActiveTab("products")}
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-all ${
            activeTab === "products"
              ? "text-[var(--color-primary-600)] border-[var(--color-primary-600)]"
              : "text-[var(--color-text-muted)] border-transparent"
          }`}
        >
          🛒 Productos
        </button>
        <button
          onClick={() => setActiveTab("ticket")}
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-all relative ${
            activeTab === "ticket"
              ? "text-[var(--color-primary-600)] border-[var(--color-primary-600)]"
              : "text-[var(--color-text-muted)] border-transparent"
          }`}
        >
          🎫 Ticket
          {itemCount > 0 && (
            <span className="absolute top-1 right-2 bg-[var(--color-danger-500)] text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
              {itemCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("payment")}
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-all ${
            activeTab === "payment"
              ? "text-[var(--color-primary-600)] border-[var(--color-primary-600)]"
              : "text-[var(--color-text-muted)] border-transparent"
          }`}
        >
          💳 Cobro
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-20">
        {activeTab === "products" && <div className="p-4">{catalogPanel}</div>}
        {activeTab === "ticket" && <div className="p-4">{ticketPanel}</div>}
        {activeTab === "payment" && <div className="p-4">{paymentPanel}</div>}
      </div>
    </div>
  );
}
