# IMPROVEMENTS_BRANCH_PRICING_PO_POS.md — Mejoras H.A.M.M.E.R. POS

> Documento de las 3 mejoras solicitadas, implementadas de forma **limpia y ordenada**:
> 1. Separación estricta de precios **por sucursal** (lo único compartido es el **costo** del producto).
> 2. Reestructuración del flujo de **pedidos de compra** (búsqueda → lista → costo → pago al llegar → ajuste de precio por sucursal).
> 3. Optimización del **POS**: top 5 más vendidos de la semana por sucursal, ocultar productos sin stock, búsqueda más rápida y funcional por nombre **y** código de barras.
>
> Cada sección explica el objetivo, qué se cambió y cómo probarlo. Al final hay notas de migración y operativas.

| # | Área | Archivos afectados | Estado |
|---|------|--------------------|--------|
| 1 | Precios por sucursal | `hammer-api/src/modules/catalog/effective-pricing.ts` | ✅ |
| 2 | Pedidos de compra | `hammer-frontend/src/app/app/master/purchase-orders/page.tsx` | ✅ |
| 3 | Optimización POS | `hammer-api/src/modules/catalog/service.ts`, `hammer-api/src/modules/inventory/unit-conversion.ts`, `hammer-api/src/app/api/catalog/products/route.ts`, `hammer-frontend/src/components/pos/branch-pos.tsx` | ✅ |
| 4 | Índice de búsqueda | `hammer-api/prisma/schema.prisma` + migración nueva | ✅ |
| 5 | Documentación | este archivo | ✅ |

---

## Mejora 1 — Separación estricta de precios por sucursal

### Objetivo
Cada sucursal debe manejar sus **precios de venta de forma independiente**. Lo único
que se comparte entre sucursales es el **costo** del producto. Nunca debe mezclarse el
precio operativo de una sucursal con el de otra.

### Cómo funciona (estado del sistema)
El repositorio ya resolvía el precio efectivo con `getEffectiveProductPricing`, que
toma el **precio configurado de la sucursal** (`branchProductSettings.salePriceOverride`)
y, solo si no existe, cae al precio estándar del producto. La venta (`sales/service.ts`)
ya usa este precio efectivo por sucursal al registrar cada línea, de modo que **la
separación de precios por sucursal ya se respeta al vender**.

### Qué se cambió
En `effective-pricing.ts` se hizo explícito y verificable este comportamiento:

- Se agregó el campo `branchPriceConfigured: boolean` al tipo `EffectivePricing`.
  - `true`  → la sucursal tiene su **propio** precio configurado (fuente `BRANCH`).
  - `false` → la sucursal aún no tiene precio propio y usa el estándar como base (fuente `STANDARD`).
- Se **exportó** `resolveEffectivePricing` para poder reutilizar la misma lógica de
  resolución en listados por lote (POS/catálogo) sin duplicar reglas.

```ts
export type EffectivePricing = {
  // ...
  priceSource: "BRANCH" | "STANDARD";
  branchPriceConfigured: boolean; // ← nuevo: deja claro si el precio es propio de la sucursal
};
```

Esto permite que la interfaz muestre con claridad si un precio es propio de la sucursal
o heredado del estándar, y que el ajuste de precios (Mejora 2) guarde **solo** el precio
de la sucursal correspondiente.

### Cómo probarlo
1. En sucursal **MGA**, configurar un precio de venta para un producto.
2. En sucursal **MSY**, el mismo producto debe seguir mostrando su propio precio (o el
   estándar si no tiene), **sin** verse afectado por MGA.
3. Vender el producto en cada sucursal y verificar que el precio aplicado corresponde al
   de esa sucursal.

---

## Mejora 2 — Reestructuración de pedidos de compra

Archivo: `hammer-frontend/src/app/app/master/purchase-orders/page.tsx`

### Objetivo
Un flujo limpio: **buscar** un producto por categoría o nombre → **agregarlo a la lista**
con su costo de compra → cálculo automático de totales → **completar el pago cuando el
producto llega** → **ajustar el precio de venta por sucursal** usando el sistema de
cálculo del propio repositorio.

### Qué se cambió

**a) Paso 1 — Búsqueda y armado de la lista**
- Se reemplazó el `<select>` por línea por un **buscador**: filtro por **categoría** +
  caja de texto que busca por **nombre, SKU o código de barras** sobre el catálogo
  cargado. Los resultados aparecen en un desplegable; al hacer clic se agregan a la lista.
- El formulario ahora inicia **vacío** y se van agregando productos uno a uno
  (`addProductLine`), evitando líneas en blanco.
- Se corrigió `fetchMeta` para traer las sucursales desde `/api/master/branches`
  (antes apuntaba incorrectamente a `/api/master/users`).

**b) Paso 2 — Costos y cálculo automático**
- Cada línea muestra el producto (solo lectura) con sus campos de **cantidad, costo,
  IVA y subtotal**, calculados automáticamente.

**c) Paso 3 — Recepción y ajuste de precio por sucursal**
- Cuando el pedido está **RECEIVED** (inventario recibido), el panel de detalle muestra
  el bloque **“Ajustar precio de venta por sucursal”**.
- El nuevo componente `BranchPriceAdjuster`:
  - Pide a `GET /api/pricing/suggested` un **precio sugerido por producto**, calculado a
    partir del **costo aterrizado** de la recepción (sistema de cálculo del repositorio).
  - Muestra una tabla con costo final, margen, precio sugerido y un campo editable.
  - Aplica con `POST /api/pricing/apply` usando `applyScope: "BRANCH"` y el `branchId`
    del pedido, de modo que **el precio se guarda solo para esa sucursal**.
  - Permite aplicar producto por producto o **todos** de una vez.

### Cómo probarlo
1. Crear un pedido: buscar productos por categoría/nombre/código y agregarlos con su costo.
2. Aprobar y **recibir** el pedido.
3. En el detalle del pedido recibido, abrir **“Ajustar precio de venta por sucursal”**,
   revisar el precio sugerido y aplicarlo. Confirmar que solo cambió en esa sucursal.

---

## Mejora 3 — Optimización del POS

### 3.1 Búsqueda más rápida (causa de los ~6 s)
Archivos: `hammer-api/src/modules/catalog/service.ts`, `hammer-api/src/modules/inventory/unit-conversion.ts`

**Problema:** por **cada** producto del listado se ejecutaban varias consultas
encadenadas (patrón N+1) para resolver inventario y conversiones de unidad, lo que hacía
la búsqueda muy lenta.

**Solución:**
- Se reemplazó el mapeo asíncrono por-producto por un mapeo **por lote**
  (`mapProductsWithBranchInventory` + `buildBranchProductRow`), que resuelve el inventario
  de toda la página con **a lo sumo 2 consultas extra** en total:
  - conversiones de stock en lote (`getProductStockConversionsBatch`, nuevo helper), y
  - balances canónicos para el caso de stock compartido (hierro).
- Se aprovechan los datos ya incluidos en la consulta principal
  (`branchProductSettings`, `inventoryBalances`), evitando consultas redundantes.
- Se preservó la lógica de **stock compartido** (p. ej. hierro: quintal ↔ varilla) usando
  el balance del producto canónico y el factor de conversión.

### 3.2 “El producto existe pero no aparece”
**Problema:** la búsqueda traía una página pequeña y luego filtraba/ordenaba sobre esa
página, por lo que productos válidos quedaban fuera por el recorte.

**Solución:** en `listProducts`, al buscar o filtrar se hace **over-fetch**
(`take = min(max(limit*10, 200), 1000)`), se mapea, se filtra por stock, se ordena por
**relevancia** y recién entonces se recorta al `limit`. Además se dejó de usar
`findUniqueOrThrow` por fila (que podía lanzar y cortar el listado).

### 3.3 Búsqueda por nombre Y código de barras + relevancia
Se agregó `searchRelevanceScore()` + `rankBySearchRelevance()` con prioridad:

| Coincidencia | Puntaje |
|---|---|
| Código de barras exacto | 100 |
| SKU exacto | 95 |
| Nombre exacto | 90 |
| Nombre empieza con… | 80 |
| SKU empieza con… | 72 |
| Código empieza con… | 68 |
| Nombre contiene… | 55 |
| SKU contiene… | 45 |
| Código contiene… | 40 |
| Categoría | 20 |

### 3.4 Ocultar productos sin stock
- `listProducts` acepta `inStockOnly?: boolean`; la ruta
  `GET /api/catalog/products` lee el parámetro `inStockOnly`.
- El POS (`branch-pos.tsx`) ahora envía `inStockOnly: "true"` en la búsqueda, de modo que
  **no se muestran productos sin existencias** en esa sucursal.

### 3.5 Top 5 más vendidos de la semana (por sucursal)
`getTopSellingProducts` se reescribió para:
- Filtrar ventas de los **últimos 7 días** (`saleOrderLine.createdAt >= hace 7 días`).
- Filtrar por **sucursal** (`saleOrder.branchId`) y excluir estados
  `CANCELLED`, `RETURNED`, `DRAFT`.
- Tomar los más vendidos, **filtrar los que tienen stock** y completar hasta 5 con
  productos activos en stock si hiciera falta (por defecto `limit = 5`).

### Cómo probarlo
1. En el POS de una sucursal, la pantalla inicial muestra los **5 más vendidos de la
   semana** de esa sucursal, todos con stock.
2. Buscar por **nombre** y por **código de barras**: los resultados aparecen rápido y
   ordenados por relevancia.
3. Un producto sin stock en esa sucursal **no** aparece en el POS.

---

## Mejora 4 — Índice de búsqueda (rendimiento)

- `hammer-api/prisma/schema.prisma`: se agregó `@@index([isActive, name])` al modelo
  `Product`.
- Migración nueva: `hammer-api/prisma/migrations/20260609120000_add_product_search_index/migration.sql`
  - Crea el índice btree `Product_isActive_name_idx`.
  - Intenta crear un índice **GIN `pg_trgm`** sobre `name` para acelerar búsquedas por
    texto; está envuelto en un bloque `DO/EXCEPTION` para **no fallar** si la extensión
    `pg_trgm` no está disponible.

### Aplicar la migración
```bash
cd hammer-api
npx prisma migrate deploy   # producción
# o, en desarrollo:
npx prisma migrate dev
```

---

## Validación realizada
- **Backend:** `cd hammer-api && npm run typecheck` ✅ y `npm test` → **75 pruebas OK**.
- **Frontend:** `cd hammer-frontend && npm run typecheck` ✅ y `npx eslint` sobre los
  archivos modificados ✅ (sin errores ni advertencias).

## Notas operativas
- No se modificó la lógica de venta: la separación de precios por sucursal ya se aplicaba
  al vender; las mejoras la hacen explícita y agregan el ajuste de precio post-recepción.
- La categoría **Hierro** (stock compartido) sigue funcionando: el mapeo por lote conserva
  el balance canónico y las conversiones de unidad.
