# Hallazgos del comportamiento intermitente en `/login`

Fecha: 2026-06-19
URL revisada: https://hammer-frontend.vercel.app/login

## Evidencia visual capturada

- Estado inicial de la pantalla de login: `/home/ubuntu/screenshots/screenshot_1781901151806.png`
- DevTools abierto en consola: `/home/ubuntu/screenshots/screenshot_1781901158993.png`
- DevTools en Network durante recarga: `/home/ubuntu/screenshots/screenshot_1781901170329.png`
- Network tras estabilizar la carga: `/home/ubuntu/screenshots/screenshot_1781901178436.png`

## Observaciones en navegador

La pantalla de login carga visualmente y mantiene la animación/estilo esperado. Al abrir DevTools y recargar, Network mostró inicialmente solicitudes `session` y `branches` como `fetch`, quedando pendientes durante la carga. Posteriormente, la pantalla quedó estable con el formulario visible, pero el flujo investigado coincide con el problema reportado: una llamada opcional a `/api/branches` desde la pantalla pública de login puede responder 401 cuando no hay sesión activa.

El cliente HTTP global (`src/lib/client/api.ts`) tenía una política de redirección automática ante cualquier 401, excepto `/api/auth/session` y `/api/auth/login`. Como `/api/branches` no estaba excluida, un 401 podía ejecutar `window.location.assign('/login')` incluso estando ya en `/login`, generando un ciclo de recarga/redirección.

## Causa raíz confirmada en código

- `src/app/login/page.tsx` ejecutaba `apiFetch('/api/branches')` al montar la pantalla pública de login.
- `src/lib/client/api.ts` redirigía automáticamente a `/login` ante 401 en rutas distintas de session/login.
- `/api/branches` es dato decorativo para mostrar sucursales; no debe invalidar ni recargar la pantalla de login.

## Fix aplicado

Se agregó una opción explícita y acotada en el cliente HTTP:

```ts
suppressAuthRedirect?: boolean
```

Luego se aplicó únicamente al fetch opcional de sucursales en login:

```ts
apiFetch('/api/branches', { suppressAuthRedirect: true })
```

Además, el efecto ahora tiene guard de cleanup (`cancelled`) y conserva la lista estática de sucursales como fallback si la API falla, responde 401 o devuelve datos inválidos.

## Resultado esperado

Un 401 de `/api/branches` ya no debe forzar `window.location.assign('/login')`, por lo que se elimina el bucle de recarga/redirección sin desactivar la protección global para llamadas autenticadas reales. La pantalla de login puede seguir renderizando con datos estáticos aunque no exista sesión.

## Validación local

En `hammer-frontend` se ejecutó:

```bash
npm run typecheck
npm run build
```

Ambos comandos finalizaron correctamente. El build solo reportó un warning preexistente y no relacionado en `src/app/app/master/transfers/page.tsx` por `_products` no usado.
