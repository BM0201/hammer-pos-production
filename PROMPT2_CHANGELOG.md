# Prompt 2 — Cliente HTTP centralizado y eliminación de logout por formulario

## Objetivo
Consolidar el cliente HTTP en `src/lib/client/api.ts` y eliminar todos los formularios HTML de logout a favor de peticiones programáticas con CSRF.

---

## Archivos creados

### `src/lib/client/api.ts` (nuevo)
- Barrel module que re-exporta `apiFetch` y `ApiFetchOptions` desde `@/lib/http`.
- Punto de entrada único para que los Client Components importen el cliente HTTP.
- No duplica lógica; simplemente actúa como wrapper/reexport.

---

## Archivos modificados

### `src/components/layout/app-shell-router.tsx`
- **Imports añadidos:** `useCallback`, `useState`, `useRouter`, `apiFetch`.
- **Handler `handleLogout`:** función async que invoca `apiFetch("/api/auth/logout", { method: "POST" })`, espera la respuesta, y luego redirige con `router.push("/login")`.
- **Estado `loggingOut`:** controla el disabled del botón y muestra "Saliendo…" durante la petición.
- **Eliminado:** `<form action="/api/auth/logout" method="post">` reemplazado por `<Button onClick={handleLogout}>`.
- El componente ya era `"use client"`, no se cambió su naturaleza.

### `src/components/pos/PosShellWrapper.tsx`
- **Imports añadidos:** `useCallback`, `useState`, `useRouter`, `apiFetch`.
- **Handler `handleLogout`:** idéntico al de `app-shell-router.tsx`.
- **Estado `loggingOut`:** misma lógica de disabled/feedback.
- **Eliminado:** `<form action="/api/auth/logout" method="post">` reemplazado por `<Button onClick={handleLogout}>`.
- El componente ya era `"use client"`, no se cambió su naturaleza.

---

## Archivos NO tocados
- Ninguna ruta API (`src/app/api/**`)
- Prisma schema
- Lógica de negocio (ventas, pagos, inventario)
- Server Components — ambos componentes modificados ya eran Client Components

---

## Criterios de aceptación verificados

| Criterio | Estado |
|---|---|
| `rg 'action="/api/auth/logout"' src` → 0 resultados | ✅ |
| `npm run typecheck` pasa sin errores | ✅ |
| Logout envía `x-csrf-token` via `apiFetch` | ✅ (automático por `apiFetch`) |
| No se duplica lógica CSRF | ✅ (se usa `apiFetch` que ya gestiona CSRF) |
| `router.push` se ejecuta DESPUÉS de que la petición complete | ✅ (dentro de `finally`) |
| Componentes mantienen su naturaleza (ambos ya eran `"use client"`) | ✅ |

---

## Flujo de logout (antes vs después)

### Antes
```html
<form action="/api/auth/logout" method="post">
  <button type="submit">Salir</button>
</form>
```
- No enviaba `x-csrf-token`
- El navegador manejaba la redirección con el response del server

### Después
```tsx
<Button onClick={handleLogout}>Salir</Button>

const handleLogout = async () => {
  await apiFetch("/api/auth/logout", { method: "POST" });
  router.push("/login");
};
```
- `apiFetch` añade automáticamente `x-csrf-token`
- Si el token es inválido, `apiFetch` lo refresca y reintenta una vez
- La redirección solo ocurre después de completar la petición
