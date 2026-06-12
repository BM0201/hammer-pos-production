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

## P0 obligatorio: separación por sucursal

La fusión de productos no debe tratar el inventario como global. En H.A.M.M.E.R.,
cada sucursal tiene su propio inventario físico y la fusión debe representarse por
sucursal.

Principios obligatorios:

- `ProductStockGroup` define la relación global entre productos.
- El stock real fusionado se calcula y modifica por `branchId`.
- El factor de conversión puede ser global.
- Las cantidades cerradas, sueltas, equivalentes, reservas y aperturas automáticas
  deben ser por sucursal.

Ejemplo real:

- Productos:
  - `KILO CLAVO ACERO 2"`
  - `CLAVO ACERO 2" UD.`
- Factor: `1 KILO = 216 UNIDADES`.
- Inventario real:
  - MGA: 0 kilo.
  - MSY: 6 kilo.
  - RIV: 0 kilo.

Resultado correcto:

- En MSY:
  - Cerrados: 6 KILO.
  - Sueltos físicos: 0 UNIDAD.
  - Abrible automático: 5 KILO si la reserva cerrada es 1.
  - Equivalente total: 1296 UNIDADES.
- En MGA:
  - Cerrados: 0 KILO.
  - Sueltos físicos: 0 UNIDAD.
  - Equivalente total: 0 UNIDADES.
- En RIV:
  - Cerrados: 0 KILO.
  - Sueltos físicos: 0 UNIDAD.
  - Equivalente total: 0 UNIDADES.

Restricciones P0:

- No se permite que el POS de MSY use stock de MGA o RIV.
- No se permite que una apertura automática en MSY modifique otra sucursal.
- No se permite vender por total agregado si la venta pertenece a una sucursal
  específica.

Modelo recomendado:

`ProductStockGroupBranchBalance`

- `id`
- `stockGroupId`
- `branchId`
- `closedPackageQuantity`
- `looseUnitQuantity`
- `equivalentBaseQuantity`
- `weightedAverageCostBase`
- `inventoryValue`
- `updatedAt`
- `unique(stockGroupId, branchId)`

Si se mantiene `InventoryBalance` como fuente temporal:

- Usar siempre `branchId + canonical/baseProductId`.
- `closedPackageQuantity` y `looseUnitQuantity` deben pertenecer a esa sucursal.
- Nunca calcular disponibilidad de venta usando balances de otras sucursales.

Reglas de lectura:

1. Al consultar inventario por sucursal, devolver solo el balance del `branchId`
   solicitado.
2. Al consultar inventario agregado, devolver detalle por sucursal y total agregado,
   marcando visualmente que es agregado.
3. El catálogo debe mostrar stock fusionado de acuerdo con la sucursal seleccionada.
4. El POS debe resolver stock usando únicamente la sucursal activa de la venta.
5. Los reportes Master pueden sumar sucursales, pero deben permitir desglose.

Reglas de venta:

- Al vender producto suelto:
  1. Obtener `branchId` de la venta.
  2. Buscar el balance fusionado de esa sucursal.
  3. Si `looseUnitQuantity` alcanza, descontar `looseUnitQuantity`.
  4. Si no alcanza, calcular paquetes abribles en esa sucursal:
     `closedPackageQuantity - minimumClosedPackageReserve`.
  5. Abrir paquetes solo en esa sucursal, sumar unidades sueltas generadas y
     descontar la venta.
  6. Registrar movimientos con `branchId`: `PACKAGE_AUTO_OPENED` y
     `LOOSE_UNIT_SALE_OUT`.
  7. No modificar balances de otras sucursales.
- Al vender producto cerrado:
  1. Obtener `branchId` de la venta.
  2. Descontar `closedPackageQuantity` de esa sucursal.
  3. Registrar `PACKAGE_SALE_OUT` con `branchId`.
  4. No tocar `looseUnitQuantity` salvo que sea una apertura explícita.

Reglas de transferencia:

- La transferencia debe indicar si mueve cerrado, suelto o ambos.
- Si mueve cerrado, descontar `closedPackageQuantity` de la sucursal origen y
  aumentar `closedPackageQuantity` en la sucursal destino.
- Si mueve suelto, descontar `looseUnitQuantity` de la sucursal origen y aumentar
  `looseUnitQuantity` en la sucursal destino.
- No convertir automáticamente durante transferencia salvo acción explícita.

UI requerida:

- En `InventoryFusionPanel`:
  - Mostrar selector o columnas por sucursal.
  - Para cada grupo fusionado mostrar: sucursal, cerrados, sueltos físicos, abrible
    automático, equivalente total y estado.
  - Si se está viendo "Todas", mostrar tabla por sucursal y total agregado.
  - No mostrar un único número global como si estuviera disponible para cualquier
    sucursal.
- En `CatalogInventoryAdmin`:
  - Cuando hay filtro de sucursal, el stock fusionado debe corresponder solo a esa
    sucursal.
  - Cuando no hay filtro, mostrar total agregado más desglose.
  - Para clavos, KILO debe mostrarse como cerrado y UNIDAD como suelto
    físico/abrible.
  - No mezclar unidades en textos como "kilo sueltos físicos".

Validaciones obligatorias:

- No vender desde una sucursal si esa sucursal no tiene cerrado, suelto o abrible
  suficiente.
- No abrir reserva cerrada de esa sucursal.
- No usar stock agregado para aprobar una venta local.
- No permitir que la fusión corrija stock en todas las sucursales al mismo tiempo
  salvo migración explícita Master.
- Toda migración debe guardar `AuditLog` por sucursal.

QA obligatorio:

1. Crear fusión `KILO CLAVO ACERO 2"` + `CLAVO ACERO 2" UD.`.
2. Configurar factor `1 KILO = 216 UNIDADES`.
3. Cargar stock: MGA = 0 kilo, MSY = 6 kilo, RIV = 0 kilo.
4. Ver inventario MSY: cerrados 6 kilo, sueltos 0 unidad, equivalente 1296 unidades.
5. Ver inventario MGA: todo 0.
6. Vender 1 unidad en MSY: MSY abre 1 kilo, queda con 5 kilo cerrados y 215 unidades
   sueltas; MGA y RIV quedan 0.
7. Intentar vender 1 unidad en MGA: debe bloquear por falta de stock.
8. Transferir 1 kilo de MSY a MGA: MSY baja a 4 o 5 según estado actual y MGA sube
   a 1 kilo cerrado.
9. Vender 1 unidad en MGA: puede abrir el kilo de MGA si no viola reserva y no toca
   MSY.
10. Confirmar que reportes Master muestran total agregado, pero POS solo usa sucursal
    activa.

Prioridad:

Este punto es P0. No es extra. Sin separación por sucursal, la fusión de inventario es
peligrosa porque puede vender stock que físicamente está en otra sucursal.

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
