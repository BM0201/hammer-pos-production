# Changelog

Todos los cambios notables de Hammer POS se documentan en este archivo.
El formato sigue, de forma laxa, [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).

## [Unreleased]

### Fixed (Corregido)

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
