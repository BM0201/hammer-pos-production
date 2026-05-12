# CSRF Integration Fix — Prompt 1 Changelog

**Fecha:** 2026-05-12  
**Objetivo:** Corregir la integración CSRF para que cualquier error de token CSRF inválido devuelva consistentemente HTTP 403 con `{ message, reason: "INVALID_CSRF_TOKEN" }`, nunca 500.

---

## Archivos Modificados

### 1. `src/modules/security/csrf.ts`
- **Nueva clase `CsrfError`**: Reemplaza los `throw new Error("INVALID_CSRF_TOKEN")` por `throw new CsrfError(detail)`. La clase incluye `reason: "INVALID_CSRF_TOKEN"` como propiedad de solo lectura, facilitando la detección en catch blocks.
- **Nuevo type-guard `isCsrfError()`**: Permite verificar de forma segura si un error desconocido es de tipo CSRF.
- `requireCsrf()` ahora lanza `CsrfError` en lugar de `Error` genérico.

### 2. `src/lib/http.ts`
- **`toHttpErrorResponse()` mejorado**:
  - Primera prioridad: detecta `CsrfError` via `isCsrfError()` → devuelve HTTP 403.
  - Mantiene compatibilidad con `Error("INVALID_CSRF_TOKEN")` legacy → también 403.
  - Agregado `FORBIDDEN_OWNER_ONLY` a la lista de errores de autorización.
- **Nuevo `apiFetch()` (client-side)**:
  - Wrapper de `fetch()` que automáticamente adjunta header `x-csrf-token`.
  - Al recibir 403 con `reason: "INVALID_CSRF_TOKEN"`, refresca el token CSRF vía `/api/auth/csrf` y reintenta la petición **exactamente una vez**.
  - Los métodos seguros (GET/HEAD/OPTIONS) no incluyen token CSRF.

### 3. `src/app/api/auth/change-password/route.ts`
- Catch block ahora usa `toHttpErrorResponse(error)` en lugar de checks manuales parciales.
- Antes: CSRF error caía al catch genérico → 500. Ahora → 403.

### 4. `src/app/api/auth/logout/route.ts`
- El catch block ahora detecta `CsrfError` explícitamente y devuelve 403.
- Antes: CSRF error era silenciado por `console.error` y el usuario recibía redirect 303. Ahora: 403 JSON.

### 5. `src/app/api/cash-closure/route.ts`
- Catch block reemplazado por `toHttpErrorResponse(error)`.

### 6. `src/app/api/cash-closure/reopen/route.ts`
- Se mantienen catches de dominio (`NO_CLOSURE_TO_REOPEN`, `CLOSURE_PERMANENTLY_CLOSED`).
- Fallback cambiado de `status: 500` genérico a `toHttpErrorResponse(error)`.

### 7. `src/app/api/timber/route.ts` (GET + POST)
- Ambos handlers ahora usan `toHttpErrorResponse(err)` como fallback.
- Se mantiene catch de ZodError y Unique constraint en POST.

### 8. `src/app/api/timber/trips/route.ts` (GET + POST)
- Fallback genérico `{ status: 500 }` reemplazado por `toHttpErrorResponse(err)`.

### 9. `src/app/api/timber/trips/[id]/route.ts` (GET + PUT + PATCH)
- Catches específicos de dominio mantenidos (NOT_FOUND, TRIP_NOT_EDITABLE, CANNOT).
- Fallback genérico reemplazado por `toHttpErrorResponse(err)`.

### 10. `src/app/api/timber/calculate/route.ts`
- Mantiene ZodError catch. Fallback → `toHttpErrorResponse(err)`.

### 11. `src/app/api/timber/pricing/route.ts` (GET + PUT)
- Fallback → `toHttpErrorResponse(err)`.

### 12. `src/app/api/timber/[id]/route.ts` (GET + PUT + DELETE)
- Catches de dominio mantenidos (TIMBER_PRODUCT_NOT_FOUND).
- Fallback → `toHttpErrorResponse(err)`.

### 13. `src/app/api/ai-insights/refresh/route.ts`
- Fallback → `toHttpErrorResponse(error)`.

---

## Archivos NO Modificados (Prohibidos)
- ❌ Prisma schema (`prisma/schema.prisma`)
- ❌ Lógica de ventas/pagos/inventario
- ❌ No se desactivó CSRF ni se añadió bypass global

---

## Validación

| Check | Resultado |
|-------|-----------|
| `npx tsc --noEmit` | ✅ Sin errores |
| `npm run build` | ✅ Compilación exitosa |
| CSRF inválido → 403 | ✅ `{ message: "CSRF inválido", reason: "INVALID_CSRF_TOKEN" }` |
| CSRF inválido → nunca 500 | ✅ Verificado en todos los routes |
| `apiFetch` refresh + retry | ✅ Implementado |

---

## Resumen Técnico

**Antes**: Cada route handler tenía su propio catch block que solo verificaba `UNAUTHENTICATED`. Si `requireCsrf()` lanzaba `Error("INVALID_CSRF_TOKEN")`, caía al catch genérico → HTTP 500.

**Después**: 
1. `requireCsrf()` lanza `CsrfError` (clase dedicada con `reason`).
2. `toHttpErrorResponse()` detecta `CsrfError` como primera prioridad → HTTP 403.
3. Todos los route handlers usan `toHttpErrorResponse()` como fallback final.
4. El cliente puede usar `apiFetch()` para manejo automático de CSRF con refresh + retry.
