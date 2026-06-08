# PRODUCTION_FIXES.md — Correcciones de producción H.A.M.M.E.R. POS

> Documento de las 4 correcciones aplicadas para dejar el sistema operativo en
> producción. Cada sección describe el problema (bug), el código **antes** y
> **después**, y cómo probarlo. Al final hay notas operativas importantes para MSY.

| # | Tipo | Archivo afectado | Estado |
|---|------|------------------|--------|
| 1 | **CRÍTICA** | `hammer-frontend/src/components/catalog-inventory/catalog-inventory-admin.tsx` | ✅ Corregido |
| 2 | UX | `hammer-frontend/src/components/cash-session/cash-session-panel.tsx` | ✅ Corregido |
| 3 | Datos | `hammer-api/prisma/seed.ts` + migración eliminada | ✅ Corregido |
| 4 | Documentación | este archivo (`PRODUCTION_FIXES.md`) | ✅ Creado |

---

## Corrección 1 (CRÍTICA) — Carga inicial de inventario falla al buscar producto

### Problema
En la pantalla **Catálogo / Inventario → Carga inicial**, cuando el usuario
**buscaba** un producto, el sistema no lo "reconocía": al seleccionarlo, el panel
de detalle quedaba vacío y la carga inicial no se podía completar.

**Causa raíz:** el componente busca el producto seleccionado únicamente en la lista
base `products`, que viene **paginada** (solo trae una porción del catálogo, p. ej.
los primeros productos). Pero cuando el usuario escribe en el buscador, los
resultados llegan de la **API de búsqueda** y se guardan en `openingSearchResults`.
Un producto encontrado por búsqueda normalmente **no** está en `products`, así que
`products.find(...)` devolvía `undefined` y el formulario "perdía" el producto.

### Antes
```tsx
const adjustmentProduct = products.find((product) => product.id === adjustment.productId);
const openingProduct = products.find((product) => product.id === opening.productId);
// ...
function editOpeningLine(line: OpeningBalanceTrayLine) {
  const product = products.find((item) => item.id === line.productId);
  // ...
}
```

### Después
```tsx
// CORRECCIÓN 1 (CRÍTICA): el producto seleccionado puede venir de los resultados
// de búsqueda (openingSearchResults) y NO estar en la lista base paginada `products`.
// Buscamos primero en los resultados de búsqueda y luego en la lista base.
const findProductById = (id: string): ProductRow | undefined =>
  (id ? openingSearchResults.find((product) => product.id === id) : undefined) ??
  products.find((product) => product.id === id);
const adjustmentProduct = findProductById(adjustment.productId);
const openingProduct = findProductById(opening.productId);
// ...
function editOpeningLine(line: OpeningBalanceTrayLine) {
  const product = findProductById(line.productId);
  // ...
}
```

### Cómo probarlo
1. Ingresa como `master` (o un usuario con permiso de inventario).
2. Ve a **Catálogo / Inventario** y abre **Carga inicial**.
3. En el buscador escribe el nombre/SKU de un producto que **no** aparezca en la
   primera página (algo que solo salga al buscar).
4. Selecciónalo de los resultados.
5. **Esperado:** el panel de detalle muestra el producto (nombre, SKU, categoría,
   unidad, stock actual) y puedes agregarlo a la carga. Antes quedaba en blanco.

---

## Corrección 2 (UX) — El botón "Abrir sesión" quedaba fuera de vista

### Problema
En el **Panel de sesión de caja**, cuando había una caja con **cierre automático
pendiente de revisión**, se mostraba un formulario de revisión grande **encima** de
los controles de apertura. Eso empujaba el botón **"Abrir sesión"** hacia abajo,
fuera de la vista, y el cajero no encontraba cómo abrir una nueva caja.

### Solución
- El formulario de revisión de cierre automático ahora es **colapsable** (oculto por
  defecto). En su lugar se muestra un **indicador claro** (punto pulsante + texto
  "⚠ Cierre automático pendiente de revisión" + contador de pendientes) con un botón
  **"Revisar ahora" / "Ocultar revisión"**.
- La acción principal **"Abrir sesión"** se movió **arriba**, en una tarjeta
  destacada (borde resaltado), y queda **siempre visible** sin importar si hay
  revisiones pendientes.
- Orden nuevo del panel: estado → caja → **Abrir sesión (destacado)** → sesión
  activa / conciliación → **revisión pendiente (colapsable, al final)**.

### Antes (orden del render)
```text
[estado] [caja]
[formulario de revisión GRANDE]   ← empujaba todo hacia abajo
[mensaje "no hay sesión"]
[Monto de apertura] [Abrir sesión]   ← quedaba fuera de pantalla
```

### Después (orden del render)
```tsx
// Acción principal SIEMPRE visible, arriba:
{!activeSession && !isReconciling && cashBoxes.length > 0 && (
  <div className="rounded-xl border-2 border-[var(--color-success-200)] ...">
    <p>No hay sesión abierta. Ingresa el monto de apertura ...</p>
    <input ... value={openingAmount} ... />
    <button data-testid="cash-session-open">Abrir sesión</button>
  </div>
)}

// Revisión de cierre automático: indicador + colapsable, al final:
{pendingAutoClosedSessions.length > 0 && (
  <div data-testid="cash-session-pending-review">
    <span className="animate-pulse ..." /> ⚠ Cierre automático pendiente de revisión
    <button onClick={() => setShowReviewForm(v => !v)}>
      {showReviewForm ? "Ocultar revisión" : "Revisar ahora"}
    </button>
    {showReviewForm && (/* formulario completo de revisión */)}
  </div>
)}
```

### Cómo probarlo
1. Ingresa como cajero/admin en una caja que tenga un **cierre automático pendiente**
   (o simula uno dejando una sesión abierta que el cron de horario cierre).
2. Abre el **Panel de sesión de caja**.
3. **Esperado:**
   - Ves de inmediato el indicador "⚠ Cierre automático pendiente de revisión" con el
     contador, **sin** el formulario gigante.
   - El bloque **"Abrir sesión"** (monto + botón) es visible sin necesidad de
     desplazarte.
   - Al pulsar **"Revisar ahora"** se despliega el formulario de revisión; al pulsar
     **"Ocultar revisión"** se colapsa.

---

## Corrección 3 — Eliminar la categoría "Hierro" sembrada automáticamente

### Problema
Una migración y el seed creaban automáticamente la categoría física **"Hierro"** (y
productos de hierro de ejemplo). En producción **la categoría se crea manualmente**,
por lo que la creación automática generaba duplicados/confusión y datos huérfanos.

### Solución
- **Eliminada** la migración `hammer-api/prisma/migrations/20260608200000_seed_iron_category/`
  (insertaba la categoría `HIERRO`).
- **Removido** del seed (`hammer-api/prisma/seed.ts`) todo el bloque que creaba la
  categoría "Hierro", los productos de hierro y sus grupos de stock + balances.
- **Se mantiene intacta** la lógica de agrupación/conversión quintal↔varilla en
  `hammer-api/src/modules/catalog/unit-conversion.ts` (detección por **nombre** del
  producto: `HIERRO ...` / `VARILLA HIERRO ...`; 3/8 = 14 varillas/quintal, 1/2 = 8,
  1/4 = 30) y el endpoint MASTER `POST /api/catalog/stock-groups/bootstrap-iron`.

> **Importante:** la categoría "Hierro" se crea **manualmente** desde el módulo de
> administración (`/app/master`). Después, los productos de hierro se agrupan
> manualmente con el endpoint `bootstrap-iron` (rol MASTER). El seed ya **no** crea
> nada de hierro para evitar datos huérfanos.

### Antes (`seed.ts`)
```ts
// ── 4. Category "Hierro" ──────────────────────────────────────
const hierro = await prisma.category.upsert({
  where: { code: "HIERRO" },
  update: { name: "Hierro", isActive: true },
  create: { code: "HIERRO", name: "Hierro", isActive: true },
});
// ── 5 + 6. Iron products + shared stock groups ──────────────
for (const size of IRON_SIZES) {
  const quintal = await prisma.product.upsert({ /* HIERRO 3/8 ... categoryId: hierro.id */ });
  const varilla = await prisma.product.upsert({ /* VARILLA HIERRO 3/8 ... */ });
  // ... grupos de stock + balances de inventario ...
}
```
Y la migración `20260608200000_seed_iron_category/migration.sql`:
```sql
INSERT INTO "Category" ("id","code","name", ...) VALUES ('cat_hierro_v2','HIERRO','Hierro', ...)
ON CONFLICT ("code") DO UPDATE SET ...;
```

### Después (`seed.ts`)
```ts
// ── CORRECCIÓN 3: Categoría "Hierro" y productos de hierro ───
// Este seed NO crea la categoría "Hierro" ni productos de hierro.
// En producción la categoría "Hierro" se crea MANUALMENTE desde /app/master,
// y los productos de hierro se agrupan manualmente con el endpoint MASTER:
//   POST /api/catalog/stock-groups/bootstrap-iron
// La lógica de detección/conversión (3/8 = 14 varillas/quintal, 1/2 = 8,
// 1/4 = 30) vive en `src/modules/catalog/unit-conversion.ts` y se mantiene intacta.
```
La carpeta de migración `20260608200000_seed_iron_category/` fue **eliminada**.

### Cómo probarlo
1. En una base limpia, corre `npx prisma migrate deploy` y luego `npm run seed`.
2. Verifica que el seed **no** crea la categoría Hierro:
   ```sql
   SELECT count(*) FROM "Category" WHERE code='HIERRO';   -- 0 (hasta crearla manualmente)
   ```
3. Crea la categoría "Hierro" manualmente desde `/app/master`.
4. (Opcional) Con productos `HIERRO ...` / `VARILLA HIERRO ...` cargados, ejecuta el
   endpoint MASTER `POST /api/catalog/stock-groups/bootstrap-iron` (`{ "apply": true }`)
   y confirma que se crean los grupos `HIERRO_3_8`, `HIERRO_1_2`, `HIERRO_1_4`.
5. Confirma que el agrupamiento quintal↔varilla sigue funcionando en ventas.

---

## Corrección 4 — Este documento

Creado `PRODUCTION_FIXES.md` (este archivo) con el detalle de cada corrección,
código antes/después e instrucciones de prueba.

---

## ⚠ Notas operativas importantes para producción

### 1. MSY (Masaya) necesita configurar su caja física
La sucursal **Masaya (MSY)** quedó **inoperativa para cobros** porque **no tiene
cajas físicas configuradas**. Sin al menos una caja física activa, **no se puede
abrir sesión de caja** y por lo tanto **no se puede cobrar**.

**Acción requerida:** un usuario MASTER debe crear la caja física de Masaya desde:

```
/app/master/cash-boxes
```

Crea una caja activa para la sucursal MSY (por ejemplo "Caja Principal Masaya") y
asígnala a los cajeros correspondientes. Después, el cajero podrá **Abrir sesión** y
empezar a cobrar.

> Nota: el seed de **desarrollo** sí crea una "Caja Principal Masaya" de ejemplo,
> pero en la base de **producción** debe crearse manualmente desde el módulo MASTER.

### 2. Cerrar los días operativos con regularidad
Se recomienda **cerrar el día operativo** de cada sucursal de forma regular (al
final de cada jornada). Si los días operativos quedan abiertos mucho tiempo:

- Las sesiones de caja pueden quedar sujetas a **cierre automático por horario**, lo
  que genera **revisiones pendientes** (ver Corrección 2).
- Se acumulan órdenes/movimientos sin conciliar, dificultando el cuadre de caja.

**Recomendación:** establecer una rutina diaria de **solicitar cierre → conciliar →
cerrar caja** y luego **cerrar el día operativo**. Así se evita la acumulación de
cierres automáticos pendientes y se mantiene el inventario y la caja cuadrados.

---

## Validación

```bash
# Backend
cd hammer-api
npm run typecheck      # tsc --noEmit
npm test               # pruebas (incluye conversión de hierro)
npm run seed           # idempotente, ya NO crea la categoría Hierro

# Frontend
cd ../hammer-frontend
npm install
npm run typecheck      # o: npx tsc --noEmit
```

> **Nota sobre localhost:** cualquier URL `localhost` mencionada corresponde a la
> máquina donde se ejecuta la aplicación (en pruebas internas, la VM del Agente
> Abacus AI), **no** a tu computadora local. Para correrlo localmente, descarga los
> archivos y despliega el proyecto en tu propio entorno.
