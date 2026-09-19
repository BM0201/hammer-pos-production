# Proxy same-origin vs. subdominio compartido — evaluación (Fase 6, prompt-flujo-velocidad.md)

**Esta es una evaluación, no una implementación.** El doc de optimización
pidió explícitamente presentar el tradeoff sin ejecutarlo — la decisión de
mover el backend a un subdominio le pertenece al dueño del producto, no a
este documento. Nada de lo descrito acá se aplicó al código.

## Cómo funciona hoy (verificado en el código, no supuesto)

`hammer-frontend` y `hammer-api` son dos proyectos de Vercel separados, cada
uno en su dominio por defecto (`hammer-frontend.vercel.app`,
`hammer-api.vercel.app` — **ninguno de los dos tiene un dominio propio
configurado todavía**, según `.env.example`). El frontend nunca toca la
base de datos directamente; todo `/api/*` se reescribe al backend con
`rewrites()` de Next.js (`next.config.ts:43-56`):

```ts
async rewrites() {
  const backendUrl = process.env.BACKEND_URL; // https://hammer-api.vercel.app
  return [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }];
}
```

Como el rewrite pasa por el edge de Vercel (server-side, antes de llegar al
navegador), el navegador **nunca ve** que la petición cruzó a otro proyecto
— para él, `/api/...` es el mismo origen que la página. De ahí salen tres
cosas gratis, sin código adicional:

1. **Cookies automáticas.** La cookie de sesión (`auth/service.ts:180-189`,
   `httpOnly`, `sameSite: "lax"`, sin `domain` explícito) se adjunta sola en
   cada request a `/api/*` porque el navegador la ve como same-origin.
2. **Sin CORS.** No hay preflight (`OPTIONS`), no hay
   `Access-Control-Allow-Origin`, no hay nada de eso configurado en
   `hammer-api` — no hace falta.
3. **El header `x-csrf-token` pasa transparente.** `apiFetch`
   (`lib/client/api.ts`) lo agrega a mutaciones con una URL relativa
   (`/api/...`); el CSRF en sí no es cookie de doble-submit, es un token
   emitido por sesión y validado contra la DB (`security/csrf.ts`) — viaja
   solo por ese header, nunca por cookie, así que no hereda el problema de
   dominio de la cookie de sesión, pero sí necesita que el header cruce
   CORS si algún día deja de ser same-origin.

`middleware.ts:62` fija además `connect-src 'self' https://challenges.cloudflare.com`
en la CSP — `'self'` cubre las llamadas a `/api/*` precisamente porque son
same-origin.

## Qué cambiaría con `api.hammer.<dominio>`

Mover el backend a un subdominio real bajo el mismo dominio raíz (en vez de
reescribir a otro proyecto de Vercel) convierte cada llamada del navegador
en una petición **cross-origin** (aunque same-site, por compartir dominio
raíz). Esto NO es gratis — cada una de las tres cosas de arriba deja de
funcionar sola y hay que cablearla a mano:

### 1. `apiFetch` (`hammer-frontend/src/lib/client/api.ts`)
- Las URLs pasan de relativas (`/api/...`) a absolutas
  (`https://api.hammer.<dominio>/api/...`), vía una env var pública
  (`NEXT_PUBLIC_API_URL` o similar).
- Cada `fetch()` necesita `credentials: "include"` explícito — `fetch` por
  defecto es `credentials: "same-origin"`, así que sin este cambio la
  cookie de sesión simplemente no viajaría, aunque el dominio esté bien
  configurado del lado del servidor.

### 2. Cookies (`hammer-api/src/modules/auth/service.ts:180-199`)
- `setSessionCookie`/`clearSessionCookie` necesitan `domain: ".hammer.<dominio>"`
  explícito para que la cookie emitida por `api.hammer.<dominio>` sea válida
  también en el subdominio del frontend (ej. `app.hammer.<dominio>`).
- `sameSite: "lax"` debería seguir funcionando entre subdominios del mismo
  dominio raíz (se consideran "same-site", no same-origin, para efectos de
  SameSite) — pero es el tipo de detalle que hay que probar de verdad en
  los navegadores objetivo, no asumir.
- Cualquier OTRA cookie que dependa hoy de ser same-origin (revisar también
  `security/turnstile.ts`, `auth/presence-service.ts` — ambos escriben
  cookies) necesita la misma revisión, una por una.

### 3. CORS (nuevo en `hammer-api`, hoy no existe nada de esto)
- Responder `Access-Control-Allow-Origin` con el origen exacto del frontend
  (nunca `*` — `Allow-Credentials: true` lo prohíbe además por spec) y
  `Access-Control-Allow-Credentials: true`.
- Manejar preflight `OPTIONS` para toda mutación (JSON + header custom
  `x-csrf-token` la convierten en "non-simple request").
- `Access-Control-Allow-Headers` debe incluir explícitamente `x-csrf-token`
  y `content-type`.

### 4. CSP del frontend (`hammer-frontend/middleware.ts:62`)
- `connect-src 'self' ...` deja de cubrir las llamadas al API — hay que
  agregar `https://api.hammer.<dominio>` explícito o el navegador bloquea
  sus propias llamadas antes de que lleguen a CORS.

### 5. Infraestructura (fuera del código)
- Ninguno de los dos proyectos tiene un dominio propio hoy — esto es
  condición previa, no un paso más: comprar/tener `hammer.<dominio>`,
  configurarlo en Vercel para AMBOS proyectos (`app.` → frontend, `api.` →
  backend), certificados TLS (Vercel los emite solo al conectar el dominio,
  bajo esfuerzo una vez que el dominio existe).

## El tradeoff, sin recomendar una respuesta

**A favor de mantener el proxy same-origin (estado actual):**
- Cero superficie de CORS — toda una clase de vulnerabilidad (política mal
  configurada, `Origin` reflejado sin validar) queda descartada por
  construcción, no por disciplina.
- Menos piezas que puedan quedar a medio migrar: hoy cookies+CSRF+CSP
  funcionan solos; con subdominio son 5 cambios independientes que TODOS
  tienen que estar bien simultáneamente o la sesión se rompe en producción.
- Para un sistema que mueve dinero, "no hay superficie de CORS que
  configurar mal" es una ventaja de seguridad real, no solo simplicidad.

**A favor de separar a subdominios:**
- Desacopla el uptime: hoy, si el rewrite de `hammer-frontend` falla o el
  proyecto tiene un problema, el API deja de ser alcanzable aunque
  `hammer-api` esté sano — con subdominios el navegador habla directo con
  `api.hammer.<dominio>`.
- Un endpoint de API estable y documentable (`api.hammer.<dominio>`) es más
  natural si en algún momento hay un cliente que no sea este frontend (app
  móvil, integración de un tercero) — hoy técnicamente ya se puede pegar
  directo a `hammer-api.vercel.app`, pero sin cookies/CORS pensados para
  eso.
- Métricas/logs separados por hostname en herramientas que indexan por
  dominio.

**Lo que no cambia ninguna de las dos formas:** el backend nunca expuso la
base de datos directamente al navegador, y esa separación se mantiene
igual — este documento es sobre CÓMO el navegador le habla al backend, no
sobre si debería.

## Si se decide avanzar

El orden importa por lo frágil que es un cambio a medias: primero el
dominio + CORS + CSP + cookie domain en un ambiente de staging real (no se
puede probar SameSite/CORS entre subdominios en `localhost`), confirmar
login + una mutación con CSRF de punta a punta, y recién ahí mover
`BACKEND_URL`/`NEXT_PUBLIC_API_URL` en producción. Este documento no cubre
ese plan de rollout en detalle — es material para cuando el dueño del
producto decida seguir adelante, no antes.
