# Fusión de Inventario — Guía de uso

## ¿Qué es?

La **Fusión de Inventario** permite unir dos o más productos que **comparten el mismo
inventario físico** pero se venden en **distintas presentaciones**.

Ejemplo clásico: el hierro de 3/8" se compra y guarda en bodega como **varillas**, pero
a veces se vende por **quintal**. Físicamente es el mismo material. Con una fusión, el
sistema mantiene **un solo stock** (en varillas) y descuenta correctamente sin importar
en qué presentación se venda.

## Conceptos clave

- **Producto principal (unidad base):** es el producto que **lleva el stock**. Siempre
  tiene factor de conversión **1**. En el ejemplo del hierro, la varilla es el principal.
- **Producto derivado:** se vende en otra presentación y **descuenta del mismo stock**
  según su **factor de conversión**.
- **Factor de conversión:** cuántas **unidades base** equivale **1 unidad** de la
  presentación derivada.
  - Hierro 3/8": `1 quintal = 14 varillas` → factor **14**.
  - Hierro 1/2": `1 quintal = 8 varillas` → factor **8**.
  - Hierro 1/4": `1 quintal = 30 varillas` → factor **30**.
  - Alambre: `1 quintal = 100 libras` → factor **100** (base = libra).
  - Clavos: `1 caja = 50 libras` → factor **50** (base = libra).

> Al **vender 1 quintal** de hierro 3/8", el sistema descuenta **14 varillas** del stock
> compartido. Al vender 1 varilla, descuenta 1. El inventario nunca se descuadra.

## Cómo crear una fusión

1. Inicie sesión como **MASTER** (o rol con permiso de catálogo).
2. En el menú lateral, vaya a **CONTROL → Fusión de Inventario**.
3. (Opcional) Haga clic en una **plantilla común** (Hierro 3/8", 1/2", 1/4", Alambre,
   Clavos). Esto precarga el nombre y le recuerda los factores; **usted asigna los
   productos**.
4. Escriba el **nombre** de la fusión y la **unidad base** (ej. `VARILLA`).
5. En **"Agregar producto"**, busque y agregue:
   - Primero el **producto principal** (queda marcado como *Principal*, factor 1).
   - Luego los **derivados**; ajuste su **unidad** y su **factor de conversión**.
6. Verifique que **solo un** producto esté marcado como *Principal*.
7. Pulse **Fusionar**.

## Cómo editar o eliminar

- En **"Fusiones existentes"**, use **Editar** para cambiar nombre, productos o factores.
- Use el botón de **papelera** para eliminar la fusión. Al eliminarla, los productos
  vuelven a manejar su stock por separado (no se borra ningún producto ni inventario).

## Reglas y validaciones

- Una fusión requiere **mínimo 2 productos** (1 principal + 1 derivado).
- Debe haber **exactamente un** producto principal, y su factor es **1**.
- El factor de cada derivado debe ser **mayor que 0**.
- Un producto **solo puede pertenecer a una fusión activa** a la vez. Si ya está en otra,
  el sistema lo avisa.

## Preguntas frecuentes

**¿Dónde se guarda el inventario?**
En el producto **principal** (unidad base). Los derivados no tienen stock propio: leen y
descuentan del stock del principal usando su factor.

**¿Qué pasa con las ventas anteriores?**
La fusión no migra cantidades existentes; a partir de su creación, las ventas de cualquier
presentación afectan el stock compartido.

**¿Puedo tener varios derivados?**
Sí. Por ejemplo, un mismo material en `caja`, `libra` y `quintal`, cada uno con su factor.

## Detalle técnico (para soporte)

- Modelo: `ProductStockGroup` + `ProductStockGroupMember` (Prisma).
- Endpoints (solo MASTER):
  - `GET /api/inventory/stock-groups` — lista fusiones activas.
  - `POST /api/inventory/stock-groups` — crea una fusión.
  - `PUT /api/inventory/stock-groups/:id` — actualiza.
  - `DELETE /api/inventory/stock-groups/:id` — desactiva (soft delete).
- La conversión venta↔stock se resuelve en
  `hammer-api/src/modules/inventory/unit-conversion.ts`
  (`getProductStockConversion`, `convertSaleQtyToBaseQty`).
