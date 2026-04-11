"use client";

import { useEffect, useState } from "react";

type SaleLine = {
  id: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  lineSubtotal: string;
};

type SaleOrder = {
  id: string;
  orderNumber: string;
  status: string;
  branchId: string;
  grandTotal: string;
  subtotal: string;
  discountTotal: string;
  lines: SaleLine[];
};

export function OrdersAdmin({ branchId, isMaster }: { branchId?: string; isMaster: boolean }) {
  const [orders, setOrders] = useState<SaleOrder[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [productSearch, setProductSearch] = useState("");
  const [products, setProducts] = useState<Array<{ id: string; sku: string; name: string }>>([]);
  const [lineForm, setLineForm] = useState({ productId: "", quantity: "1", unitPrice: "", discountAmount: "0" });

  const activeBranchId = branchId ?? "";

  async function load() {
    const query = new URLSearchParams();
    if (activeBranchId) query.set("branchId", activeBranchId);
    const res = await fetch(`/api/sales/orders?${query.toString()}`);
    const json = (await res.json()) as { data: SaleOrder[] };
    setOrders(json.data ?? []);
    if (!selected && json.data?.length) setSelected(json.data[0].id);
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, [activeBranchId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const q = productSearch.trim();
      fetch(`/api/catalog/products${q ? `?q=${encodeURIComponent(q)}` : ""}`)
        .then((res) => res.json())
        .then((json: { data?: Array<{ id: string; sku: string; name: string }> }) => setProducts(json.data ?? []))
        .catch(() => undefined);
    }, 150);

    return () => clearTimeout(timer);
  }, [productSearch]);

  async function createOrder() {
    if (!activeBranchId) return;
    await fetch("/api/sales/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId: activeBranchId }),
    });
    await load();
  }

  async function addLine(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    await fetch(`/api/sales/orders/${selected}/lines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: lineForm.productId,
        quantity: Number(lineForm.quantity),
        discountAmount: Number(lineForm.discountAmount),
        ...(lineForm.unitPrice ? { unitPrice: Number(lineForm.unitPrice) } : {}),
      }),
    });
    setLineForm({ productId: "", quantity: "1", unitPrice: "", discountAmount: "0" });
    await load();
  }

  async function removeLine(lineId: string) {
    if (!selected) return;
    await fetch(`/api/sales/orders/${selected}/lines/${lineId}`, { method: "DELETE" });
    await load();
  }

  async function submitOrder() {
    if (!selected) return;
    await fetch(`/api/sales/orders/${selected}/submit`, { method: "POST" });
    await load();
  }

  const current = orders.find((order) => order.id === selected);

  return (
    <section className="space-y-4">
      {!activeBranchId ? <p className="text-sm text-[var(--color-warning-700)]">Selecciona una sucursal para crear o editar borradores.</p> : null}
      <div className="flex gap-2">
        <button className="rounded-lg border border-[var(--color-border)] px-3 py-2" onClick={load}>Actualizar</button>
        <button className="rounded-lg bg-[var(--color-info-700)] hover:bg-[var(--color-info-800)] px-3 py-2 text-white disabled:opacity-60" onClick={createOrder} disabled={!activeBranchId}>Nuevo borrador</button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h2 className="font-semibold mb-2">Órdenes</h2>
          <ul className="space-y-2">
            {orders.map((order) => (
              <li key={order.id}>
                <button className="w-full rounded-lg border border-[var(--color-border)] p-2 text-left" onClick={() => setSelected(order.id)}>
                  <div className="font-medium">{order.orderNumber}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{order.status} · Total {order.grandTotal}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="font-semibold mb-2">Editor de borrador</h2>
          {current ? (
            <div className="space-y-3">
              <div className="text-sm text-[var(--color-text-muted)]">Estado: {current.status}</div>

              <form className="grid gap-2" onSubmit={addLine}>
                <input className="rounded-lg border border-[var(--color-border)] px-3 py-2" placeholder="Buscar producto por nombre o SKU" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
                <select className="rounded-lg border border-[var(--color-border)] px-3 py-2" value={lineForm.productId} onChange={(e) => setLineForm({ ...lineForm, productId: e.target.value })} required>
                  <option value="">Selecciona producto</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>
                  ))}
                </select>
                <input className="rounded-lg border border-[var(--color-border)] px-3 py-2" type="number" min="0.0001" step="0.0001" placeholder="Cantidad" value={lineForm.quantity} onChange={(e) => setLineForm({ ...lineForm, quantity: e.target.value })} required />
                <input className="rounded-lg border border-[var(--color-border)] px-3 py-2" type="number" min="0" step="0.01" placeholder="Precio unitario (opcional)" value={lineForm.unitPrice} onChange={(e) => setLineForm({ ...lineForm, unitPrice: e.target.value })} />
                <input className="rounded-lg border border-[var(--color-border)] px-3 py-2" type="number" min="0" step="0.01" placeholder="Descuento" value={lineForm.discountAmount} onChange={(e) => setLineForm({ ...lineForm, discountAmount: e.target.value })} />
                <button className="rounded-lg border border-[var(--color-border)] px-3 py-2" type="submit">Agregar línea</button>
              </form>

              <table className="w-full text-sm border-collapse">
                <thead><tr className="border-b text-left"><th className="py-2">Producto</th><th>Cant.</th><th>Precio</th><th>Desc.</th><th>Subtotal</th><th></th></tr></thead>
                <tbody>
                  {current.lines.map((line) => (
                    <tr key={line.id} className="border-b">
                      <td className="py-2">{products.find((p) => p.id === line.productId)?.name ?? line.productId}</td><td>{line.quantity}</td><td>{line.unitPrice}</td><td>{line.discountAmount}</td><td>{line.lineSubtotal}</td>
                      <td><button className="rounded-lg border border-[var(--color-border)] px-2 py-1" onClick={() => removeLine(line.id)}>Quitar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="text-sm">
                <div>Subtotal: {current.subtotal}</div>
                <div>Descuento: {current.discountTotal}</div>
                <div className="font-semibold">Total general: {current.grandTotal}</div>
              </div>

              <button className="rounded-lg bg-[var(--color-success-700)] px-3 py-2 text-white" onClick={submitOrder}>Enviar a pendiente de pago</button>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">No hay orden seleccionada.</p>
          )}
        </div>
      </div>
    </section>
  );
}
