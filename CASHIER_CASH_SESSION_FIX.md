# Corrección: el cajero puede abrir la caja + mostrar el nombre real de quien la abrió

## Contexto del negocio

La caja es **una sola caja física compartida** por sucursal. Tanto el rol
**vendedor (SALES)** como el rol **cajero (CASHIER)** trabajan sobre esa misma
caja física. Por lo tanto, el cajero debe poder **abrir** la sesión de caja del
día, no solo usarla. La caja no "pertenece" a un usuario: es del punto de venta.

Además, como varias personas comparten la misma caja, en el panel de caja debe
verse claramente **"Caja abierta por [Nombre Real]"** usando el nombre completo
de la persona (no el nombre de usuario), para saber quién la dejó abierta.

## Dónde se definen los roles y permisos

- **Catálogo de roles:** `hammer-api/src/modules/rbac/policies.ts`
  - Roles del sistema: `MASTER`, `BRANCH_ADMIN`, `SALES`, `CASHIER`, etc.
  - El mapa `ROLE_CAPABILITIES` asocia cada rol con sus capacidades (permisos).
- **Catálogo de capacidades:** `CAPABILITIES` en el mismo archivo
  (`CASH_SESSION_OPEN`, `CASH_SESSION_OPERATE`, `CASH_SESSION_USE`, etc.).
- **Evaluación de permisos por sucursal:** `canInBranch` / `canInAnyAssignedBranch`
  (también en `policies.ts`), apoyados por
  `hammer-api/src/modules/rbac/effective-permissions.ts`.
- **Matriz de referencia legible:** `RBAC_MATRIX.md`.

## Dónde está el código de apertura de caja

- **Endpoint HTTP:** `hammer-api/src/app/api/cashier/cash-sessions/open/route.ts`
- **Lógica de negocio:** `openCashSession` en
  `hammer-api/src/modules/cash-session/service.ts`
- **Panel del frontend:** `hammer-frontend/src/components/cash-session/cash-session-panel.tsx`

## Diagnóstico

1. **Inconsistencia de permisos (el problema principal):**
   Existía una capacidad dedicada `CASH_SESSION_OPEN` que **solo** se otorgaba a
   `BRANCH_ADMIN` y `MASTER`. La matriz `RBAC_MATRIX.md` documentaba
   explícitamente que el cajero **no** podía abrir caja (`cash_session.open = —`).
   Esto contradecía la regla de negocio (caja física compartida) y era un riesgo:
   si en el futuro el endpoint de apertura pasaba a exigir `CASH_SESSION_OPEN`,
   los cajeros quedarían bloqueados.

   En la práctica el endpoint de apertura validaba `CASH_SESSION_OPERATE` (que el
   cajero sí tenía), por lo que un cajero bien configurado podía abrir; pero la
   definición de permisos y la documentación quedaban incoherentes.

2. **Faltaba mostrar quién abrió la caja:**
   El panel de caja no mostraba "Caja abierta por ...". El backend ya devolvía el
   dato (`openedBy { id, username, fullName }`), pero la interfaz no lo usaba.

3. **Bloqueos legítimos (no son errores, es diseño):** aunque el permiso sea
   correcto, la apertura puede fallar por reglas de negocio válidas:
   - `OPERATIONAL_DAY_NOT_OPEN`: el día operativo no está abierto (lo abre un
     administrador).
   - No hay una caja física activa en la sucursal.
   - La configuración de rol por sucursal (`BranchRoleConfig`) tiene deshabilitado
     al cajero.

## Cambios realizados

### 1. Otorgar `CASH_SESSION_OPEN` al rol CASHIER
`hammer-api/src/modules/rbac/policies.ts` — se agregó la capacidad
`CASH_SESSION_OPEN` al rol `CASHIER`, dejando explícito que el cajero puede abrir
la caja física compartida.

### 2. El endpoint de apertura acepta CASH_SESSION_OPEN (con compatibilidad)
`hammer-api/src/app/api/cashier/cash-sessions/open/route.ts` — la validación de
permiso ahora acepta **`CASH_SESSION_OPEN` o `CASH_SESSION_OPERATE`** (esta última
por compatibilidad con roles que ya operaban la caja). Se mantiene intacta la
lógica de rechazo por rol/sucursal (FORBIDDEN) y de MASTER.

### 3. Mostrar el nombre real de quien abrió la caja
`hammer-frontend/src/components/cash-session/cash-session-panel.tsx` — en el
detalle de la sesión abierta se agregó la línea
**"👤 Caja abierta por: [Nombre Real]"**, usando `openedBy.fullName` y cayendo al
`username` solo si no hubiera nombre completo.

### 4. Documentación de permisos coherente
`RBAC_MATRIX.md` — se actualizó la matriz: `cash_session.open` ahora es ✅ para
Cajero y para Vendedor-Cajero; los perfiles de Cajero/Vendedor-Cajero dicen
"abre · solicita cierre"; y la descripción del rol CASHIER indica que **abre** y
opera la sesión de caja (caja física compartida).

### 5. Prueba automatizada
`hammer-api/src/modules/rbac/policies.test.ts` — nueva prueba que verifica que
CASHIER tiene `CASH_SESSION_OPEN/OPERATE/USE/CLOSE_REQUEST`, que BRANCH_ADMIN y
MASTER conservan `CASH_SESSION_OPEN`, y que SALES **no** tiene `CASH_SESSION_OPEN`.

## Validación

- `hammer-api`: `npm run typecheck` ✅ y `npm test` ✅ (76 pruebas, incluida la nueva).
- `hammer-frontend`: `npm run typecheck` ✅ y `eslint` del panel ✅.

## Archivos modificados

- `hammer-api/src/modules/rbac/policies.ts`
- `hammer-api/src/app/api/cashier/cash-sessions/open/route.ts`
- `hammer-api/src/modules/rbac/policies.test.ts`
- `hammer-frontend/src/components/cash-session/cash-session-panel.tsx`
- `RBAC_MATRIX.md`
- `CASHIER_CASH_SESSION_FIX.md` (este documento)
