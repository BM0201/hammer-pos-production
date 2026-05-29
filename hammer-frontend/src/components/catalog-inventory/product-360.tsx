"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Branch = { id: string; code: string; name: string };
type ProductDetail = {
  product: {
    id: string;
    sku: string;
    name: string;
    unit: string;
    isActive: boolean;
    standardSalePrice: string;
    category?: { name: string };
    inventoryBalances: Array<{ id: string; quantityOnHand: string; weightedAverageCost: string; inventoryValue: string; branch: Branch }>;
    inventoryMovements: Array<{ id: string; createdAt: string; movementType: string; quantity: string; unitCost: string; referenceType: string; referenceId: string; branch: Branch }>;
    branchProductSettings: Array<{ id: string; isAvailable: boolean; branchCost?: string | null; branchPrice?: string | null; branch: Branch }>;
    reorderPolicies: Array<{ id: string; minQuantity: string; reorderPoint: string; targetQuantity: string; branch: Branch }>;
    brainDecisions: Array<{ id: string; createdAt: string; status: string; severity: string; category: string; title: string; branch?: Branch | null }>;
  };
  auditLogs: Array<{ id: string; occurredAt: string; module: string; action: string; entityType: string; actor?: { username: string; fullName?: string | null } | null; branch?: Branch | null }>;
};

type Tab = "general" | "stock" | "movements" | "pricing" | "brain" | "audit";

function money(value: string | number | null | undefined) {
  return new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(Number(value ?? 0));
}

export function Product360({ productId }: { productId: string }) {
  const [data, setData] = useState<ProductDetail | null>(null);
  const [tab, setTab] = useState<Tab>("general");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/master/catalog-inventory/products/${productId}`, { cache: "no-store" })
      .then(async (response) => {
        const raw = await response.json();
        if (!response.ok) throw new Error(raw.message ?? "No se pudo cargar el producto.");
        setData(raw.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar el producto."));
  }, [productId]);

  if (error) return <Card className="p-4 text-sm text-[var(--color-danger-700)]">{error}</Card>;
  if (!data) return <Card className="p-4 text-sm text-[var(--color-text-muted)]">Cargando Producto 360...</Card>;

  const product = data.product;
  const totalStock = product.inventoryBalances.reduce((sum, item) => sum + Number(item.quantityOnHand), 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={"/app/master/catalog-inventory" as Route} className="text-xs text-[var(--color-text-muted)]">Catalogo e Inventario</Link>
          <h1 className="text-xl font-bold text-[var(--color-text)]">{product.sku} · {product.name}</h1>
          <p className="text-sm text-[var(--color-text-muted)]">{product.category?.name ?? "Sin categoria"} · {product.unit}</p>
        </div>
        <Badge variant={product.isActive ? "success" : "warning"}>{product.isActive ? "Activo" : "Inactivo"}</Badge>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)] pb-1">
        {[
          ["general", "Datos generales"],
          ["stock", "Existencias por sucursal"],
          ["movements", "Movimientos / Kardex"],
          ["pricing", "Precios y costos"],
          ["brain", "Brain"],
          ["audit", "Auditoria"],
        ].map(([id, label]) => (
          <Button key={id} size="sm" variant={tab === id ? "primary" : "ghost"} onClick={() => setTab(id as Tab)}>{label}</Button>
        ))}
      </div>

      {tab === "general" ? (
        <div className="grid gap-3 md:grid-cols-4">
          <Card className="p-4"><p className="text-xs text-[var(--color-text-muted)]">Stock total</p><p className="text-2xl font-bold">{totalStock}</p></Card>
          <Card className="p-4"><p className="text-xs text-[var(--color-text-muted)]">Precio base</p><p className="text-2xl font-bold">{money(product.standardSalePrice)}</p></Card>
          <Card className="p-4"><p className="text-xs text-[var(--color-text-muted)]">Sucursales con balance</p><p className="text-2xl font-bold">{product.inventoryBalances.length}</p></Card>
          <Card className="p-4"><p className="text-xs text-[var(--color-text-muted)]">Movimientos</p><p className="text-2xl font-bold">{product.inventoryMovements.length}</p></Card>
        </div>
      ) : null}

      {tab === "stock" ? (
        <Card className="p-4"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th>Sucursal</th><th>Cantidad</th><th>Costo promedio</th><th>Valor</th></tr></thead><tbody>{product.inventoryBalances.map((item) => <tr key={item.id} className="border-b"><td className="py-2">{item.branch.code} · {item.branch.name}</td><td>{item.quantityOnHand}</td><td>{money(item.weightedAverageCost)}</td><td>{money(item.inventoryValue)}</td></tr>)}</tbody></table></Card>
      ) : null}

      {tab === "movements" ? (
        <Card className="p-4"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th>Fecha</th><th>Sucursal</th><th>Tipo</th><th>Cantidad</th><th>Costo</th><th>Referencia</th></tr></thead><tbody>{product.inventoryMovements.map((item) => <tr key={item.id} className="border-b"><td className="py-2">{new Date(item.createdAt).toLocaleString("es-NI")}</td><td>{item.branch.code}</td><td>{item.movementType}</td><td>{item.quantity}</td><td>{money(item.unitCost)}</td><td>{item.referenceType} · {item.referenceId}</td></tr>)}</tbody></table></Card>
      ) : null}

      {tab === "pricing" ? (
        <Card className="p-4"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th>Sucursal</th><th>Disponible</th><th>Costo sucursal</th><th>Precio sucursal</th></tr></thead><tbody>{product.branchProductSettings.map((item) => <tr key={item.id} className="border-b"><td className="py-2">{item.branch.code} · {item.branch.name}</td><td>{item.isAvailable ? "Si" : "No"}</td><td>{item.branchCost ? money(item.branchCost) : "Base"}</td><td>{item.branchPrice ? money(item.branchPrice) : "Base"}</td></tr>)}</tbody></table></Card>
      ) : null}

      {tab === "brain" ? (
        <Card className="p-4"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th>Fecha</th><th>Estado</th><th>Severidad</th><th>Categoria</th><th>Decision</th><th>Sucursal</th></tr></thead><tbody>{product.brainDecisions.map((item) => <tr key={item.id} className="border-b"><td className="py-2">{new Date(item.createdAt).toLocaleString("es-NI")}</td><td>{item.status}</td><td>{item.severity}</td><td>{item.category}</td><td>{item.title}</td><td>{item.branch?.code ?? "GLOBAL"}</td></tr>)}</tbody></table></Card>
      ) : null}

      {tab === "audit" ? (
        <Card className="p-4"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th>Fecha</th><th>Modulo</th><th>Accion</th><th>Sucursal</th><th>Usuario</th></tr></thead><tbody>{data.auditLogs.map((item) => <tr key={item.id} className="border-b"><td className="py-2">{new Date(item.occurredAt).toLocaleString("es-NI")}</td><td>{item.module}</td><td>{item.action}</td><td>{item.branch?.code ?? "GLOBAL"}</td><td>{item.actor ? `${item.actor.fullName || item.actor.username} (usuario: ${item.actor.username})` : "sistema"}</td></tr>)}</tbody></table></Card>
      ) : null}
    </section>
  );
}
