import { NextResponse, type NextRequest } from "next/server";

/**
 * Frontend (hammer-frontend) middleware.
 *
 * E · Fase 1 (prompt-completo-pendientes-2026-10.md) — este archivo vivía en
 * la raíz del proyecto (hammer-frontend/middleware.ts). Con un directorio
 * `src/`, Next.js exige que middleware.ts viva DENTRO de `src/`, al lado de
 * `app/` — si no, lo ignora en silencio: ni error de build, ni warning, el
 * matcher simplemente nunca corre. Confirmado empíricamente (curl a /health
 * con next dev y next start): sin ningún header que esta función agrega —
 * ni el nonce, ni la CSP, ni siquiera un header de depuración agregado a
 * propósito para probarlo — hasta moverlo acá. Esto significa que la CSP,
 * el nonce de scripts inline y el gate de cookie de /app/* NUNCA corrieron
 * en este proyecto, desde el primer commit (`git log` del archivo viejo
 * solo tiene el snapshot inicial). No es nada de esta Parte — se encontró
 * verificando el requisito de Fase 1 ("confirmar que el motor WASM carga
 * sin errores de CSP"), y se corrigió porque dejarlo roto habría hecho que
 * agregar 'wasm-unsafe-eval' acá no sirviera de nada.
 *
 * Scope: only protects the UI route surface. The backend (hammer-api) handles
 * its own auth/CSRF middleware.
 *
 * What this does:
 *  - Lets `_next/*`, static assets, and public pages through.
 *  - Lets `/api/*` requests through untouched (they are rewritten to the
 *    backend by `next.config.ts`).
 *  - Performs a SHALLOW cookie-presence check for `/app/*` pages. The HMAC
 *    of the session is validated by the backend on every API request, so
 *    we deliberately do NOT decode tokens here (no node:crypto, no DB).
 *  - Redirects authenticated users away from /login (cookie present).
 *  - Generates a per-request CSP nonce and sets the Content-Security-Policy
 *    header dynamically. In production, `script-src` uses
 *    `'nonce-...' 'strict-dynamic'` (NO 'unsafe-inline'); Next.js reads the
 *    CSP from the request headers and stamps the nonce on its own inline
 *    scripts. Custom inline scripts read the nonce via `headers()` →
 *    `x-nonce` (see src/app/layout.tsx). The rest of the security headers
 *    (HSTS, X-Frame-Options, etc.) still live in next.config.ts.
 *
 * Role-based redirects (master vs branch vs sysadmin) live in
 * `src/app/app/page.tsx`, which calls `GET /api/auth/session` and routes
 * the user to the correct landing page.
 */
// Páginas públicas (sin cookie de sesión): /login, /unauthorized, /forbidden,
// /health. No viven bajo /app, así que el gate de cookie no las toca; sí
// reciben CSP con nonce como cualquier página renderizada.
const SESSION_COOKIE = "__Host-hammer_session";

const isDev = process.env.NODE_ENV !== "production";

// Archivos estáticos reales (public/, sw.js, assets) — pasan sin CSP ni auth.
// Deliberadamente por extensión conocida y NO `pathname.includes(".")`: una
// ruta de app que contenga un punto (ej. un SKU en la URL) debe seguir
// recibiendo CSP y nonce.
const STATIC_FILE_RE = /\.(js|mjs|css|map|ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|eot|json|txt|xml|webmanifest|pdf|mp4|webm)$/i;

// Orígenes externos permitidos para <script> (Turnstile). Una sola lista para
// dev y prod — al agregar un origen aquí, ambos CSP lo heredan.
const SCRIPT_ORIGINS = "https://challenges.cloudflare.com";

function buildCsp(nonce: string): string {
  // challenges.cloudflare.com: widget de Turnstile en el login (script + iframe
  // + verificación). fonts.googleapis.com/gstatic: @import de DM Mono en /login.
  // 'wasm-unsafe-eval': prompt-completo-pendientes-2026-10.md, Parte E,
  // Fase 1 — el escáner de cámara usa el polyfill WASM de BarcodeDetector
  // (barcode-detector/zxing-wasm) cuando el navegador no trae el nativo.
  // Habilita SOLO la instanciación de WebAssembly, no unsafe-eval genérico
  // — el .wasm se sirve siempre desde este mismo dominio (public/vendor/zxing/),
  // nunca de un CDN.
  const scriptSrc = isDev
    ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${SCRIPT_ORIGINS}`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval' ${SCRIPT_ORIGINS}`;

  return [
    "default-src 'self'",
    scriptSrc,
    // 'unsafe-inline' se mantiene en style-src: la app usa <style> inline en
    // varios componentes (login, modales). Los style={{...}} de React son
    // atributos, no los bloquea style-src.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static assets
  if (pathname.startsWith("/_next") || STATIC_FILE_RE.test(pathname)) {
    return NextResponse.next();
  }

  // API requests → rewrites send them to the backend
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has(SESSION_COOKIE);

  // Gate /app/* on cookie presence (a stale cookie will be cleared by the
  // backend's 401 on the first apiFetch). Las PUBLIC_PATHS no pasan por aquí
  // (ninguna vive bajo /app) pero sí reciben CSP con nonce más abajo.
  if (!hasSession && pathname.startsWith("/app")) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }

  // Already authenticated visitors should not see the login page.
  if (hasSession && pathname === "/login") {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  // CSP con nonce por request para las páginas que sí se renderizan.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js lee este header para poner el nonce en sus scripts inline.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
