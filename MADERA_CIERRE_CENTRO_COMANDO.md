# MADERA_CIERRE_CENTRO_COMANDO.md — Tres módulos nuevos H.A.M.M.E.R. POS

> Documento de las **tres funcionalidades** desarrolladas en la rama
> `feat/wood-module-autoclose-command-center`. Cada sección describe **qué hace**,
> **cómo funciona** (backend + frontend), los archivos afectados y cómo probarlo.

| # | Módulo | Estado | Commit |
|---|--------|--------|--------|
| 1 | **Módulo de Madera completo** (precio por pie + inyección a inventario) | ✅ | `feat(madera): …` |
| 2 | **Cierre automático de cajas** configurable (5:30 PM por defecto) | ✅ | `feat(caja): …` |
| 3 | **Centro de Comando** (dashboard master en vivo) | ✅ | `feat(centro-comando): …` |

Moneda: **C$ (córdobas)**. Zona horaria: **America/Managua (UTC-6)**.

---

## 1. Módulo de Madera completo

### Qué hace
Permite gestionar la madera en **PIES** (pies tablares). El sistema:

1. Calcula automáticamente los **pies totales** por viaje a partir de las medidas
   estándar y las cantidades.
2. Acepta dos formas de costear el viaje:
   - **Costo total del viaje** (modo `TOTAL`): se reparte entre los pies.
   - **Precio por pie** (modo `PER_FOOT`): por ejemplo **C$52 por pie**; el valor
     total = `precio_por_pie × pies_totales`.
3. Funciona como **borrador (DRAFT)**: el viaje se cubica y revisa antes de
   afectar el inventario.
4. Al **confirmar**, **inyecta toda la madera al inventario** de la sucursal de
   destino (movimientos `TIMBER_INTAKE_IN`) y deja el viaje como `TRANSFERRED`.
   Esta acción **no se puede deshacer**.

### Cómo funciona

**Backend**
- `hammer-api/src/modules/timber/calculator.ts`
  - Nueva interfaz `TimberTripCostOptions` y 4º parámetro `options` en
    `calculateTimberTrip(...)`.
  - En modo `PER_FOOT`, cuando `options.costPerFootInput > 0`, se usa ese valor
    como costo por pie y se deriva el costo total = `costPerFoot × piesTotales`.
- `hammer-api/src/modules/timber/validators.ts`: campo opcional `costPerFoot` en
  los esquemas de creación/actualización.
- `hammer-api/src/modules/timber/service.ts`
  - Helpers `resolveTimberCategoryTx` (categoría `MAD` / "Madera") y
    `resolveTimberProductForLineTx` (producto + SKU determinístico
    `MAD-<GRUPO>-<EspesorxAnchoxLargo>`).
  - `confirmTimberTrip` **reescrito**: valida estado `DRAFT/CUBICADO`, líneas no
    vacías y costo por pie > 0; dentro de una transacción inyecta cada línea al
    inventario y marca el viaje como `TRANSFERRED` (con auditoría
    `TIMBER_TRIP_CONFIRMED_AND_INJECTED`).
- `hammer-api/src/app/api/timber/trips/[id]/route.ts`: mapea errores
  `TRIP_HAS_NO_LINES` (409) y `TRIP_REQUIRES_COST` (400).

**Frontend**
- `hammer-frontend/src/components/timber/timber-trips.tsx`
  - Selector de **modo de costo**: *Costo total* / *Precio por pie*.
  - Resumen de cubicación con 4 columnas: piezas, pies, **costo/pie**, costo total.
  - Diálogo de confirmación advierte que se inyectará toda la madera al inventario.

### Cómo probarlo
1. Crear un viaje de madera, agregar medidas y cantidades → revisar pies totales.
2. Elegir **Precio por pie**, escribir `52` → el costo total debe ser
   `52 × pies`.
3. Confirmar el viaje → el inventario de la sucursal de destino debe aumentar y el
   viaje queda **Transferido**.
4. Pruebas: `cd hammer-api && npm test` (incluye `calculator.test.ts`).

---

## 2. Cierre automático de cajas (configurable)

### Qué hace
Cierra automáticamente **todas las cajas abiertas** a una hora configurable y deja
sus reportes listos para revisión. Por defecto:

- **Lunes a Viernes:** 17:30 (5:30 PM)
- **Sábado:** 16:00
- **Domingo:** sin cierre

Todo es **configurable** por usuarios MASTER desde la interfaz, **sin migración ni
redepliegue**.

### Cómo funciona

**Backend**
- `hammer-api/src/modules/cash-session/auto-close-config.ts` (nuevo)
  - Configuración guardada como JSON en la tabla genérica `SystemSetting`
    (clave `cash_auto_close_config`).
  - `getCashAutoCloseConfig()` / `updateCashAutoCloseConfig()` con auditoría
    `CASH_AUTO_CLOSE_CONFIG_UPDATED` y `normalizeCashAutoCloseConfig()` (validación
    pura de horas `HH:mm`).
- `hammer-api/src/modules/cash-session/auto-close-service.ts`
  - `getCashAutoCloseDeadline(branch, now, config)` usa la configuración para
    calcular el límite de cierre según el día de la semana.
  - `autoCloseExpiredCashSessions` carga la configuración y la aplica.
- `hammer-api/src/app/api/master/cash-auto-close-config/route.ts` (nuevo): GET y
  PUT (con CSRF + acceso MASTER + validación zod de horas).

**Frontend**
- `hammer-frontend/src/app/app/master/settings/cash-auto-close/page.tsx` (nuevo):
  página de administración con interruptor general, horarios por día (Lun-Vie,
  Sábado, Domingo) y zona horaria.
- `hammer-frontend/src/components/navigation/app-sidebar.tsx`: nuevo enlace
  **"Cierre Automático"** bajo el grupo de Cajas.

### Cómo probarlo
1. Entrar como MASTER → *Cierre Automático*.
2. Cambiar la hora de Lun-Vie a otra hora, guardar → debe persistir al recargar.
3. Pruebas: `cd hammer-api && npm test` (incluye `auto-close-config.test.ts`).

> **Nota:** el cierre automático mantiene el paso intermedio
> `AUTO_CLOSED_PENDING_REVIEW` (revisión) por diseño; los reportes del día
> operativo se actualizan automáticamente.

---

## 3. Centro de Comando (dashboard master en vivo)

### Qué hace
Vista consolidada en **tiempo real** para MASTER que reúne en una sola pantalla:

- **Usuarios conectados** (presencia: en línea / inactivos / desconectados).
- **Cierres de caja**: pendientes, completados hoy e historial.
- **Estado de cajas físicas** por sucursal.
- **Métricas del día operativo** actual (ventas, diferencia de caja, etc.).
- **Actualización automática cada 20 segundos** e indicador "En vivo".

### Cómo funciona

**Backend**
- `hammer-api/src/modules/dashboard/command-center.ts` (nuevo):
  `getCommandCenterSnapshot()` agrega en una sola respuesta presencia de usuarios,
  estado de cajas/sesiones por sucursal, cierres (pendientes/hoy/historial),
  cajas físicas y métricas del día operativo. Es **solo lectura**.
- `hammer-api/src/app/api/master/command-center/route.ts` (nuevo): GET con acceso
  MASTER.

**Frontend**
- `hammer-frontend/src/app/app/master/page.tsx` (**reescrito**): KPIs ejecutivos,
  tarjetas de estado operativo por sucursal, panel de cierres con pestañas y panel
  de usuarios conectados.

### Cómo probarlo
1. Entrar como MASTER → *Dashboard Global / Centro de Comando*.
2. Verificar KPIs, tarjetas por sucursal, pestañas de cierres y usuarios
   conectados; la vista se refresca sola cada 20s.

---

## Validación general

```bash
# Backend
cd hammer-api && npm run typecheck && npm test   # 84 pruebas

# Frontend
cd hammer-frontend && npx tsc --noEmit
```
