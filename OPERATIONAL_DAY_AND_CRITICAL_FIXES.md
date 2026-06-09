# Día operativo automatizado + corrección de bugs críticos

Este documento explica qué era el "día operativo", por qué bloqueaba la
operación, qué se decidió y qué código se reescribió. También cubre los otros
dos bugs críticos: precios en "C$ 1.00" y la contraseña visible en el login.

---

## 1. ¿Qué es el "día operativo"?

El **día operativo** (`OperationalDay`) es un registro por sucursal y por fecha
que **agrupa toda la actividad de una jornada**: las sesiones de caja, las
ventas, los pagos y los totales del día. Sirve para:

- Asociar cada **sesión de caja** a una jornada (`cashSession.operationalDayId`).
- Generar el **reporte diario** y el **cierre del día** (checklist, totales de
  ventas, diferencias de caja, etc.).
- Tener un corte contable/administrativo por jornada.

### El problema

El día operativo **debía abrirlo manualmente un administrador**. Si nadie lo
abría:

- Los **cajeros no podían abrir caja** (`openCashSession` lanzaba
  `OPERATIONAL_DAY_NOT_OPEN`).
- No se podían **crear ventas** (`createDraftSaleOrder` lanzaba el mismo error).
- Esto generaba errores 409/500 y **bloqueaba toda la operación**, incluso para
  el usuario `master`.

En la práctica, era un candado manual que frenaba el trabajo diario sin aportar
nada que no se pudiera automatizar.

---

## 2. Decisión: AUTOMATIZAR (no eliminar)

El día operativo **sí aporta valor real** al negocio: es la base del **cierre de
caja** y del **reporte diario**, y agrupa las sesiones de caja. Eliminarlo por
completo obligaría a reescribir cierre de caja, reportes, resúmenes y varias
relaciones de base de datos, perdiendo trazabilidad.

Por eso, siguiendo la instrucción del usuario ("si es necesario para el negocio
→ automatízalo para que se abra automáticamente"), se decidió **conservar el
concepto pero eliminar el bloqueo manual**: el día operativo ahora **se abre
solo, automáticamente**, cuando se necesita.

---

## 3. Código reescrito (no parches)

### 3.1 `ensureOpenOperationalDayTx` — apertura automática
`hammer-api/src/modules/operations/service.ts`

Antes lanzaba un error si no había día abierto:

```ts
export async function ensureOpenOperationalDayTx(tx, branchId) {
  const day = await getOpenOperationalDayForBranchTx(tx, branchId);
  if (!day) throw new Error("OPERATIONAL_DAY_NOT_OPEN");
  return day;
}
```

Ahora **garantiza** un día abierto: si no existe, lo **crea automáticamente**; y
si el día de hoy quedó cerrado/cancelado, lo **reactiva**. Es idempotente y
seguro ante concurrencia (maneja la restricción única `branchId + businessDate`
y la carrera `P2002`). Además registra en auditoría
`OPERATIONAL_DAY_AUTO_OPENED` / `OPERATIONAL_DAY_AUTO_REOPENED`.

Se añadió también la variante fuera de transacción `ensureOpenOperationalDay()`.

### 3.2 Apertura de caja usa la auto-apertura
`hammer-api/src/modules/cash-session/service.ts` — `openCashSession` ahora pasa
el `actorUserId` y, al abrir caja, el día operativo se abre solo si hace falta.
**El cajero ya no depende de un administrador.**

### 3.3 Creación de ventas usa la auto-apertura
`hammer-api/src/modules/sales/service.ts` — `createDraftSaleOrder` ya no lanza
`OPERATIONAL_DAY_NOT_OPEN`; llama a `ensureOpenOperationalDay()` y continúa.

### 3.4 Mensajes de UI actualizados
`hammer-frontend/src/lib/pos-ui.ts` y
`hammer-frontend/src/components/cash-session/cash-session-panel.tsx` — el mensaje
de `OPERATIONAL_DAY_NOT_OPEN` ya no dice "solicita a un administrador"; ahora
indica que basta con reintentar abrir la caja (se reactiva solo). Este error
prácticamente ya no aparece en el flujo normal.

> Los administradores **siguen pudiendo** abrir/cerrar el día manualmente desde
> la sección de Operaciones para el cierre y los reportes; lo único que cambió es
> que ya no es un requisito previo que bloquee a cajeros y vendedores.

---

## 4. Bug: precios mostrando "C$ 1.00" (Masaya)

### Causa raíz
Al **crear productos por importación** sin precio, el código asignaba un precio
ficticio de **C$ 1.00** de forma silenciosa:

- `hammer-api/src/modules/catalog-inventory/import-service.ts`
  → `standardSalePrice: ... ?? new Prisma.Decimal(1)`
- `hammer-api/src/modules/import-excel/service.ts`
  → `standardSalePrice: ... ?? 1`

La sucursal Masaya cargó su catálogo por importación sin precios, así que **todos
los productos quedaron en C$ 1.00**. (El cálculo de precio efectivo es correcto:
`branchPrice ?? standardSalePrice`; el problema era el dato sembrado en 1.00.)

### Corrección
Se eliminó el precio inventado. Ahora, si un producto nuevo **no trae precio**
(ni en la fila ni como default del lote), **no se crea con C$ 1.00**: la línea
**falla/omite con un mensaje claro** para que se corrija el dato. Así nunca más
se guarda un precio falso silenciosamente.

> **Datos ya existentes:** los productos que hoy estén en C$ 1.00 por la carga
> anterior deben corregirse asignándoles su precio real (precio de venta del
> producto o `branchPrice` de la sucursal). El cambio de código evita que vuelva
> a ocurrir, pero no reescribe automáticamente los precios ya guardados.

---

## 5. Bug de seguridad: contraseña visible en el login

La página de **login mostraba la contraseña por defecto en texto plano**
(`ElChele1234!`) como "ayuda de primer ingreso", visible para cualquiera sin
autenticarse.

### Corrección
- `hammer-frontend/src/components/login-form.tsx` — se **eliminó** el texto que
  mostraba la contraseña.
- `hammer-frontend/src/app/app/change-password/page.tsx` — se quitó la
  contraseña literal del aviso de primer ingreso y del placeholder; ahora se
  refiere a ella como "tu contraseña temporal".

> La referencia interna en el panel de administración de usuarios se mantiene
> porque es un contexto **autenticado y solo para administradores** (necesario al
> resetear contraseñas).

---

## 6. Validación

- `hammer-api`: `npm run typecheck` ✅ y `npm test` ✅ (75 pruebas).
- `hammer-frontend`: `npm run typecheck` ✅ y `eslint` de los archivos tocados ✅.

### Cómo probar manualmente
1. Con el día operativo cerrado (o sin abrir), un **cajero abre caja** → debe
   funcionar sin intervención del admin (el día se abre solo).
2. Crear una **venta** sin día abierto → debe funcionar.
3. Importar un producto **sin precio** → debe rechazar/omitir esa línea con
   mensaje claro (ya no queda en C$ 1.00).
4. Abrir la página de **login** → ya no se muestra ninguna contraseña.

---

## 7. Archivos modificados

- `hammer-api/src/modules/operations/service.ts`
- `hammer-api/src/modules/cash-session/service.ts`
- `hammer-api/src/modules/sales/service.ts`
- `hammer-api/src/modules/catalog-inventory/import-service.ts`
- `hammer-api/src/modules/import-excel/service.ts`
- `hammer-frontend/src/components/login-form.tsx`
- `hammer-frontend/src/app/app/change-password/page.tsx`
- `hammer-frontend/src/lib/pos-ui.ts`
- `hammer-frontend/src/components/cash-session/cash-session-panel.tsx`
- `OPERATIONAL_DAY_AND_CRITICAL_FIXES.md` (este documento)
