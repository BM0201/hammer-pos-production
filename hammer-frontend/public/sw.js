// Hammer POS — Service Worker (app shell cache)
// Caches the POS page and its static assets so the app loads without network.
// API calls are intentionally NOT intercepted — the React layer handles offline data.
//
// Bug reportado: un despliegue nuevo en el servidor no se veía reflejado en
// el navegador. Causa real: CACHE era un string fijo que nunca cambiaba
// entre despliegues — el `activate` de abajo solo borra los buckets de
// caché que NO se llamen como `CACHE`, así que si el nombre nunca cambia,
// nunca se purga nada y un cliente que ya tenía la app abierta puede seguir
// sirviendo el HTML/JS viejo desde su caché local indefinidamente.
//
// IMPORTANTE: subir este número EN CADA despliegue que necesite forzar a los
// navegadores ya abiertos a refrescar. layout.tsx registra este archivo con
// `updateViaCache: "none"` para que el navegador siempre revise bytes
// frescos de ESTE archivo (nunca desde su propio caché HTTP) — así el
// cambio de versión se detecta de forma confiable.
const CACHE = "hammer-pos-v2";
const PRECACHE = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Cache-first for immutable Next.js static bundles (content-hashed filenames).
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
          return res;
        });
      }),
    );
    return;
  }

  // Network-first for API calls — let the React layer handle offline behavior.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ message: "Sin conexión" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    return;
  }

  // Network-first with cache fallback for HTML navigation (POS pages).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached ?? caches.match("/"))),
    );
    return;
  }
});
