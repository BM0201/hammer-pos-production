# Changelog

Todos los cambios notables de Hammer POS se documentan en este archivo.
El formato sigue, de forma laxa, [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).

## [Unreleased]

### Fixed (Corregido)

- **Revisión profunda: 17 archivos sobrescritos por copy-paste en `77429df` restaurados.**
  El commit `77429df` ("chore: pending changes…") no solo vació el layout: también
  sobrescribió múltiples páginas y route handlers "índice" con el contenido COPIADO
  de una ruta hermana. El build/typecheck pasaban, pero cada ruta mostraba/servía el
  contenido equivocado. Se restauraron al último estado bueno (`6959cd2`) **sin perder
  las mejoras posteriores** (fix de login, restauración de layout, fixes de Suspense):
  - **Páginas (frontend):**
    - `/app/master` (Centro de Comando) ← estaba duplicando la página de Usuarios.
    - `/app/branch` (Mi Sucursal, KPIs) ← estaba mostrando el workspace de Despacho.
    - `/app/master/production` (Producción Materiales) ← duplicaba la página de Recetas.
    - `/app/master/audit` (Bitácora Global) ← duplicaba Print Logs.
    - `/app/master/catalog-inventory` (CatalogInventoryAdmin) ← duplicaba Product360.
    - `/app/system-admin` (Dashboard Admin) ← duplicaba Configuraciones.
    - `/app` (índice → home por rol) ← duplicaba Configuraciones.
    - `/` (raíz → redirect a /app) ← duplicaba la página de Sesión Requerida.
  - **Route handlers (API):**
    - `catalog/products` (listado + alta de productos) ← solo devolvía sugerencia de SKU.
    - `master/discounts` (listar + crear descuentos) ← solo devolvía sugerencias.
    - `cash-closure` (POST cierre automático manual) ← duplicaba `/status`.
    - `master/brain/decisions/[id]` (GET decisión) ← duplicaba `/snooze`.
    - `sales/orders/[id]` (PATCH notas de orden) ← duplicaba `/submit`.
    - `reports/sales` (exportación CSV) ← duplicaba `/summary`.
    - `timber` (productos de madera) ← duplicaba `/trips`.
- **`/app/master` y toda el área autenticada se mostraban sin sidebar ni header.**
  El commit `77429df` había vaciado `hammer-frontend/src/app/app/layout.tsx`,
  eliminando `<AppShellRouter>` (sidebar + header + breadcrumbs + footer +
  heartbeat) y la guardia de sesión para todas las rutas `/app/*`. Se restauró
  el layout autenticado. (PR #21)
- **Bucle infinito de redirección en el módulo de Madera.**
  El mismo commit `77429df` dejó `master/timber/page.tsx` con
  `redirect("/app/master/timber")` apuntando a su **propia** ruta (error de
  copy-paste, función `TimberTripsPage`). Se restauró la página original del
  módulo de Madera (calculadora de cubicación + control de viajes).

### Added (Agregado) — medidas preventivas

- **Script de validación de archivos críticos**
  (`hammer-frontend/scripts/validate-critical-files.mjs`): detecta layouts/páginas
  críticas vaciadas y `redirect()` que apuntan a su propia ruta. Disponible como
  `npm run validate:critical` y enganchado como `prebuild` (corre antes de
  `npm run build`).
- **Tests unitarios estructurales** (`hammer-frontend/tests/unit/critical-files.test.mjs`,
  `npm run test:unit`): verifican —sin necesidad de backend— que los layouts y el
  shell críticos conservan su contenido y que ninguna página redirige a sí misma.
- **Plantilla de Pull Request** (`.github/PULL_REQUEST_TEMPLATE.md`) con checklist
  obligatorio (typecheck, lint, validate:critical, test:unit, build) y advertencia
  sobre archivos críticos y commits-escoba.
- **Documentación de archivos críticos** (`docs/ARCHIVOS_CRITICOS.md`): lista de
  archivos que rompen la app sin generar errores de compilación y cómo protegerse.

---

> Nota histórica: el commit `77429df` ("chore: pending changes from previous
> sessions") fue un commit-escoba que mezcló cambios no relacionados y vació
> archivos por accidente. A partir de ahora se recomiendan PRs de alcance único
> y revisar el `git diff` completo antes de commitear (ver `docs/ARCHIVOS_CRITICOS.md`).
