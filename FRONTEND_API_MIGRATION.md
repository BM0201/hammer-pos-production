# Migración Frontend a apiFetch — H.A.M.M.E.R. POS/ERP

## Resumen

Migración de componentes frontend de `fetch()` directo a `apiFetch()` para cumplir con la política de seguridad CSRF del proyecto. `apiFetch` (definido en `src/lib/client/api.ts`) agrega automáticamente el header `x-csrf-token` y maneja la rotación de tokens cuando recibe un 403 `INVALID_CSRF_TOKEN`.

**Total de archivos modificados:** 25 componentes frontend + 4 rutas API backend (correcciones de sintaxis pre-existentes)  
**Total de fetch() reemplazados:** 52  
**Excepciones justificadas:** 1 (`login-form.tsx`)

---

## Archivos Frontend Modificados

| # | Archivo | Cambios | Métodos |
|---|---------|---------|---------|
| 1 | `src/components/users/users-admin.tsx` | 5 fetch → apiFetch | POST, PATCH, DELETE |
| 2 | `src/components/payroll/employee-manager.tsx` | 3 fetch → apiFetch | POST, PUT, DELETE |
| 3 | `src/components/sales/orders-admin.tsx` | 4 fetch → apiFetch | POST, DELETE |
| 4 | `src/components/timber/timber-form.tsx` | 2 fetch → apiFetch | POST, PUT |
| 5 | `src/components/timber/timber-calculator.tsx` | 1 fetch → apiFetch | PUT |
| 6 | `src/components/timber/timber-trips.tsx` | 2 fetch → apiFetch | POST, PATCH |
| 7 | `src/components/timber/timber-list.tsx` | 1 fetch → apiFetch | DELETE |
| 8 | `src/components/catalog/products-admin.tsx` | 3 fetch → apiFetch | POST, PATCH |
| 9 | `src/components/catalog/categories-admin.tsx` | 2 fetch → apiFetch | POST, PATCH |
| 10 | `src/components/cash-boxes/master-cash-boxes.tsx` | 1 fetch → apiFetch | PATCH |
| 11 | `src/components/inventory/inventory-import-admin.tsx` | 2 fetch → apiFetch | POST |
| 12 | `src/components/inventory/inventory-admin.tsx` | 1 fetch → apiFetch | POST |
| 13 | `src/components/approvals/approvals-queue.tsx` | 1 fetch → apiFetch | PATCH |
| 14 | `src/components/expenses/expense-manager.tsx` | 3 fetch → apiFetch | POST, DELETE |
| 15 | `src/components/owner/branch-module-config.tsx` | 2 fetch → apiFetch | PUT |
| 16 | `src/components/dispatch/dispatch-workspace.tsx` | 3 fetch → apiFetch | POST, PATCH |
| 17 | `src/components/analytics/analytics-dashboard.tsx` | 1 fetch → apiFetch | POST |
| 18 | `src/app/app/master/ai-insights/page.tsx` | 1 fetch → apiFetch | POST |
| 19 | `src/app/app/master/discounts/page.tsx` | 3 fetch → apiFetch | POST, PUT, DELETE |
| 20 | `src/app/app/master/transfers/page.tsx` | 3 fetch → apiFetch | POST |
| 21 | `src/app/app/master/analytics/abc-xyz/page.tsx` | 2 fetch → apiFetch | PUT |
| 22 | `src/app/app/master/purchase-orders/page.tsx` | 3 fetch → apiFetch | POST |
| 23 | `src/app/app/change-password/page.tsx` | 1 fetch → apiFetch | POST |
| 24 | `src/app/app/system-admin/settings/page.tsx` | 1 fetch → apiFetch | PUT |
| 25 | `src/app/app/system-admin/role-config/page.tsx` | 1 fetch → apiFetch | PUT |

---

## Correcciones Adicionales (Backend)

Se corrigieron errores de sintaxis pre-existentes en rutas API backend causados por imports mal formateados durante el hardening CSRF anterior:

| Archivo | Problema | Corrección |
|---------|----------|------------|
| `src/app/api/expenses/route.ts` | Import roto (`import {` seguido de otro `import`) | Reordenado imports |
| `src/app/api/expenses/[id]/route.ts` | Import roto | Reordenado imports |
| `src/app/api/pricing/config/route.ts` | Import roto | Reordenado imports |
| `src/app/api/analytics/classify/route.ts` | Import roto | Reordenado imports |

Se corrigieron rutas API con `requireCsrf` en funciones GET (no aplica CSRF a lecturas) y parámetros `_request` renombrados a `request` donde `requireCsrf` los necesita:

- Removido `requireCsrf` de 14 funciones GET
- Corregido `_request` → `request` en funciones DELETE/PATCH/PUT de 3 archivos

---

## Patrón de Migración

### ANTES (fetch directo — inseguro):
```typescript
const response = await fetch('/api/catalog/products', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(productData),
});
```

### DESPUÉS (apiFetch — seguro con CSRF):
```typescript
import { apiFetch } from '@/lib/client/api';

const response = await apiFetch('/api/catalog/products', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(productData),
});
```

### Lo que se conservó intacto:
- ✅ JSON.stringify(body)
- ✅ Headers personalizados
- ✅ Manejo de errores (try/catch)
- ✅ Loading states
- ✅ Refresh de datos (mutate, refetch, etc.)
- ✅ Validación de response.ok
- ✅ Toast/notificaciones
- ✅ Diseño visual
- ✅ Flujo de negocio
- ✅ Estados de UI

---

## Cambios Detallados por Componente

### src/components/users/users-admin.tsx
- ✅ POST `/api/master/users` — crear usuario
- ✅ PATCH `/api/master/users/:id` — actualizar usuario
- ✅ POST `/api/master/users/:id/memberships` — crear membresía
- ✅ PATCH `/api/master/users/:id/memberships/:mid` — actualizar membresía
- ✅ DELETE `/api/master/users/:id/memberships/:mid` — eliminar membresía

### src/components/payroll/employee-manager.tsx
- ✅ POST/PUT `/api/employees` — crear/actualizar empleado (método variable)
- ✅ DELETE `/api/employees/:id` — desactivar empleado
- ✅ POST `/api/payroll/calculate` — calcular nómina

### src/components/sales/orders-admin.tsx
- ✅ POST `/api/sales/orders` — crear orden
- ✅ POST `/api/sales/orders/:id/lines` — agregar línea
- ✅ DELETE `/api/sales/orders/:id/lines/:lineId` — eliminar línea
- ✅ POST `/api/sales/orders/:id/submit` — enviar orden

### src/components/catalog/products-admin.tsx
- ✅ POST `/api/catalog/products` — crear producto
- ✅ PATCH `/api/catalog/products/:id` — actualizar producto
- ✅ POST `/api/master/catalog/products/:id/cleanup` — limpiar producto

### src/components/catalog/categories-admin.tsx
- ✅ POST `/api/catalog/categories` — crear categoría
- ✅ PATCH `/api/catalog/categories/:id` — actualizar categoría

### src/components/expenses/expense-manager.tsx
- ✅ POST `/api/expenses` — crear gasto
- ✅ DELETE `/api/expenses/:id` — eliminar gasto
- ✅ POST `/api/pricing/config` — actualizar config de precios

### src/components/dispatch/dispatch-workspace.tsx
- ✅ POST `/api/warehouse/dispatch/:id/dispatch` — despachar orden
- ✅ POST `/api/transport` — crear transporte
- ✅ PATCH `/api/transport/:id` — actualizar transporte

### src/components/timber/timber-form.tsx
- ✅ POST `/api/timber` — crear producto madera
- ✅ PUT `/api/timber/:id` — actualizar producto madera

### src/components/timber/timber-calculator.tsx
- ✅ PUT `/api/timber/pricing` — actualizar precios

### src/components/timber/timber-trips.tsx
- ✅ POST `/api/timber/trips` — crear viaje
- ✅ PATCH `/api/timber/trips/:id` — actualizar viaje

### src/components/timber/timber-list.tsx
- ✅ DELETE `/api/timber/:id` — eliminar producto madera

### src/components/cash-boxes/master-cash-boxes.tsx
- ✅ PATCH `/api/master/cash-boxes/:id/toggle` — toggle caja

### src/components/inventory/inventory-import-admin.tsx
- ✅ POST `/api/master/inventory/import` — preview importación
- ✅ POST `/api/master/inventory/import` — ejecutar importación

### src/components/inventory/inventory-admin.tsx
- ✅ POST `/api/inventory/movements` — crear movimiento

### src/components/approvals/approvals-queue.tsx
- ✅ PATCH `/api/approvals/:id` — aprobar/rechazar

### src/components/owner/branch-module-config.tsx
- ✅ PUT `/api/branch-config` — actualizar configuración (×2)

### src/components/analytics/analytics-dashboard.tsx
- ✅ POST `/api/analytics/classify` — clasificar ABC-XYZ

### src/app/app/master/ai-insights/page.tsx
- ✅ POST `/api/ai-insights/refresh` — refrescar insights

### src/app/app/master/discounts/page.tsx
- ✅ POST/PUT `/api/master/discounts` — crear/actualizar descuento (método variable)
- ✅ DELETE `/api/master/discounts/:id` — eliminar descuento
- ✅ PUT `/api/master/discounts/:id` — toggle descuento

### src/app/app/master/transfers/page.tsx
- ✅ POST `/api/master/transfers` — crear transferencia
- ✅ POST `/api/master/transfers/:id/approve` — aprobar
- ✅ POST `/api/master/transfers/:id/cancel` — cancelar

### src/app/app/master/analytics/abc-xyz/page.tsx
- ✅ PUT `/api/master/analytics/abc-xyz/:id` — actualizar (×2)

### src/app/app/master/purchase-orders/page.tsx
- ✅ POST `/api/master/purchase-orders` — crear orden de compra
- ✅ POST `/api/master/purchase-orders/:id/approve` — aprobar
- ✅ POST `/api/master/purchase-orders/:id/cancel` — cancelar

### src/app/app/change-password/page.tsx
- ✅ POST `/api/auth/change-password` — cambiar contraseña

### src/app/app/system-admin/settings/page.tsx
- ✅ PUT `/api/system-admin/settings` — actualizar configuración

### src/app/app/system-admin/role-config/page.tsx
- ✅ PUT `/api/system-admin/role-config` — actualizar roles

---

## Excepciones

| Archivo | Justificación |
|---------|---------------|
| `src/components/login-form.tsx` | Llama `/api/auth/login` — no existe sesión aún, el endpoint está excluido de CSRF |

---

## Casos donde apiFetch NO debe usarse

1. **Server Components** (archivos sin `'use client'`): Usan fetch nativo de Next.js con cache/revalidate. No aplica apiFetch (solo cliente).

2. **APIs externas** (fuera del proyecto): Ejemplo: llamadas a Stripe, SendGrid, etc. Usar fetch directo o cliente específico.

3. **GET requests**: Por convención del proyecto, GET usa fetch nativo. Solo mutaciones (POST/PUT/PATCH/DELETE) usan apiFetch.

4. **Login** (`/api/auth/login`): No hay sesión activa, el token CSRF no puede validarse.

---

## Testing

### Verificación de tipos TypeScript
```bash
npx tsc --noEmit
```

### Compilación Next.js (requiere DATABASE_URL y AUTH_SESSION_SECRET)
```bash
npm run build
```

### Verificación automática de seguridad frontend
```bash
npx tsx scripts/verify-frontend-api-calls.ts
```

### Testing manual
- [ ] Login funciona
- [ ] Crear producto funciona
- [ ] Editar usuario funciona
- [ ] Eliminar categoría funciona
- [ ] Crear orden de venta
- [ ] Despachar orden
- [ ] Crear/editar empleado
- [ ] Registrar gasto
- [ ] Importar inventario
- [ ] Aprobar transferencia
- [ ] Cambiar contraseña
- [ ] Configuración del sistema

---

## Riesgos Corregidos

- ❌ **ANTES:** Componentes fallaban con `403 MISSING_CSRF_TOKEN` al intentar mutar datos
- ❌ **ANTES:** Bypass del patrón de seguridad CSRF del proyecto
- ✅ **AHORA:** Todos los componentes envían tokens CSRF automáticamente via `apiFetch`
- ✅ **AHORA:** Rotación automática de tokens en caso de expiración

---

## Comandos Útiles

```bash
# Buscar usos de fetch en componentes (debería solo mostrar GETs)
grep -rn "fetch(" src/components/ src/app/ --include="*.tsx" --include="*.ts" | grep -v apiFetch | grep -v node_modules

# Verificar imports de apiFetch
grep -rn "apiFetch" src/components/ src/app/ --include="*.tsx" --include="*.ts"

# Verificación automática completa
npx tsx scripts/verify-frontend-api-calls.ts
```
