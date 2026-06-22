# 🛡️ Archivos Críticos — Hammer POS Frontend

Este documento lista los archivos cuya modificación accidental **rompe toda la
aplicación sin generar errores de compilación**. Modifícalos con cuidado y pide
doble revisión en cualquier PR que los toque.

> **Por qué existe este documento:** el commit `77429df` ("chore: pending
> changes from previous sessions") vació por accidente `src/app/app/layout.tsx`
> (dejando toda el área autenticada **sin sidebar ni header**) y dejó
> `master/timber/page.tsx` redirigiendo a sí mismo (**bucle infinito**).
> Ninguno de los dos fallos rompió `build` ni `typecheck`, por eso llegaron a
> producción. Estos son fallos "invisibles" para el compilador.

---

## 🔴 Críticos — NO modificar sin entender el impacto global

| Archivo | Rol | Si se rompe… |
|---|---|---|
| `hammer-frontend/src/app/app/layout.tsx` | Monta `<AppShellRouter>` (sidebar + header + breadcrumbs + footer + heartbeat) y la **guardia de sesión** para **todo `/app/*`**. | Todas las rutas autenticadas pierden la navegación y la protección de sesión. |
| `hammer-frontend/src/app/layout.tsx` | Layout raíz: `<html>`, `<body>`, fuentes, anti-FOUC de tema, `<ToastContainer>`. | La app no renderiza correctamente / fallan estilos y toasts globales. |
| `hammer-frontend/src/components/layout/app-shell-router.tsx` | Implementa el shell: sidebar, header con rol, breadcrumbs, heartbeat, logout. | Navegación rota en toda el área autenticada. |
| `hammer-frontend/src/lib/client/api.ts` | `apiFetch` central: CSRF, manejo de 401/403, redirecciones. | Errores de auth en cascada, posibles bucles de recarga. |
| `hammer-frontend/middleware.ts` | Gate de rutas y redirecciones `/login` ↔ `/app`. | Bucles de redirección o accesos indebidos. |
| `hammer-frontend/src/app/login/page.tsx` | Formulario de acceso + MFA. | Nadie puede iniciar sesión. |

## 🟡 Sensibles — revisar redirects y contratos de API

- Páginas con `redirect()` (no deben apuntar a su **propia** ruta → bucle):
  - `src/app/app/master/timber/page.tsx`
  - `src/app/app/master/timber/trips/page.tsx`
  - `src/app/app/master/inventory/page.tsx`
  - `src/app/app/master/employees/page.tsx`
  - `src/app/app/master/catalog/products/page.tsx`

---

## ✅ Cómo protegerse antes de hacer merge

Ejecuta **siempre** estos comandos (o deja que CI los corra):

```bash
cd hammer-frontend
npm run validate:critical   # integridad de archivos críticos (rápido)
npm run test:unit           # tests estructurales de layouts/redirects
npm run typecheck           # tipos
npm run lint                # estándares
npm run build               # compilación (corre validate:critical en prebuild)
```

- `npm run validate:critical` **falla** si un archivo crítico se vació o si una
  página redirige a sí misma. Está enganchado como `prebuild`, así que
  `npm run build` lo ejecuta automáticamente.
- Si necesitas cambiar **a propósito** la estructura de un archivo crítico (p. ej.
  renombrar `AppShellRouter`), actualiza también:
  - `hammer-frontend/scripts/validate-critical-files.mjs`
  - `hammer-frontend/tests/unit/critical-files.test.mjs`
  - este documento.

## 🧯 Reglas de oro

1. **PRs pequeños y de alcance único.** Evita commits "chore: pending changes…"
   que mezclan cambios no relacionados — fueron la causa del incidente.
2. **Revisa el `git diff` completo** antes de commitear. Verifica que ningún
   archivo quedó vaciado o reducido a un stub sin querer.
3. **Tras tocar auth/layout/navegación, prueba el flujo real:** login →
   `/app/master` debe mostrar sidebar + header y permitir navegar.
