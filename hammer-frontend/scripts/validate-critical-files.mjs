#!/usr/bin/env node
/**
 * validate-critical-files.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * Guardia de integridad para archivos críticos del frontend de Hammer POS.
 *
 * Contexto / motivación
 * ---------------------
 * El commit `77429df` ("chore: pending changes...") vació por accidente
 * `src/app/app/layout.tsx` (eliminando `<AppShellRouter>` → toda el área
 * autenticada quedó sin sidebar/header) y dejó `master/timber/page.tsx`
 * redirigiendo a sí mismo (bucle infinito). Ninguno de los dos fallos rompía
 * el `build` ni el `typecheck`, por eso pasaron a producción inadvertidos.
 *
 * Este script detecta exactamente esa clase de regresiones "invisibles":
 *   1. Archivos críticos que se convirtieron en un passthrough vacío.
 *   2. Layouts críticos que dejaron de montar el contenedor esperado.
 *   3. Páginas con `redirect()` apuntando a su propia ruta (self-redirect).
 *
 * Uso:
 *   node scripts/validate-critical-files.mjs
 *   npm run validate:critical
 *
 * Sale con código 1 (falla CI) si encuentra cualquier problema.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "src");

/* ── Estilos de consola ─────────────────────────────────────────────────── */
const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const errors = [];
const checked = [];

function read(rel) {
  const abs = join(SRC, rel);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, "utf8");
}

/**
 * Regla 1: el archivo debe contener TODOS los marcadores indicados.
 * Sirve para asegurar que un layout/página crítica no se reemplazó por un stub.
 */
function mustContain(rel, markers, why) {
  const content = read(rel);
  checked.push(rel);
  if (content === null) {
    errors.push(`✗ ${rel}\n    No existe. ${why}`);
    return;
  }
  const missing = markers.filter((m) => !content.includes(m));
  if (missing.length > 0) {
    errors.push(
      `✗ ${rel}\n    Falta(n) marcador(es) requerido(s): ${missing
        .map((m) => `"${m}"`)
        .join(", ")}\n    ${why}`,
    );
  }
}

/**
 * Regla 1b: dos rutas distintas NO deben tener contenido idéntico.
 *
 * El commit `77429df` sobrescribió varias páginas/route handlers "índice" con
 * el contenido COPIADO de una ruta hermana (p.ej. `master/page.tsx` quedó
 * igual a `master/users/page.tsx`; `catalog/products/route.ts` quedó igual al
 * handler de `sku-suggestion`). El build/typecheck pasaban, pero la ruta
 * mostraba/servía el contenido equivocado. Esta regla detecta esa clase de
 * regresión por copy-paste comparando el contenido normalizado de ambos.
 */
function mustNotDuplicate(relA, relB, why) {
  const a = read(relA);
  const b = read(relB);
  checked.push(relA);
  if (a === null || b === null) return; // si alguno falta, otras reglas lo reportan
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  if (norm(a) === norm(b)) {
    errors.push(
      `✗ ${relA}\n    Tiene contenido IDÉNTICO a ${relB} → probable sobrescritura por copy-paste.\n    ${why}`,
    );
  }
}

/**
 * Regla 2: una página no debe redirigir a su propia ruta (bucle infinito).
 * Deduce la ruta a partir de la ubicación del archivo (App Router).
 */
function noSelfRedirect(rel) {
  const content = read(rel);
  checked.push(rel);
  if (content === null) {
    errors.push(`✗ ${rel}\n    No existe (esperado para chequeo de self-redirect).`);
    return;
  }
  const m = content.match(/redirect\(\s*["'`]([^"'`?]+)/);
  if (!m) return; // no hace redirect → nada que validar
  const target = m[1].replace(/\/$/, "");

  // Ruta propia: src/app/app/master/timber/page.tsx → /app/master/timber
  const routePath =
    "/" +
    rel
      .replace(/^app\//, "")
      .replace(/\/page\.tsx$/, "")
      .replace(/\\/g, "/");

  if (target === routePath) {
    errors.push(
      `✗ ${rel}\n    redirect("${target}") apunta a su PROPIA ruta → bucle infinito de redirección.`,
    );
  }
}

/* ── Definición de chequeos críticos ────────────────────────────────────── */

// El shell autenticado: sidebar + header + breadcrumbs deben venir de aquí.
mustContain(
  "app/app/layout.tsx",
  ["AppShellRouter", "/api/auth/session"],
  "Este layout monta el shell autenticado (sidebar/header) y la guardia de sesión para TODO /app/*. Si se vacía, todas las rutas autenticadas pierden la navegación.",
);

// El layout raíz: <html>, fuentes y anti-FOUC de tema.
mustContain(
  "app/layout.tsx",
  ["<html", "<body", "ToastContainer"],
  "Layout raíz de la app. Debe renderizar <html>/<body> y los providers globales.",
);

// La página de login debe seguir teniendo su formulario de credenciales.
mustContain(
  "app/login/page.tsx",
  ["/api/auth/login"],
  "La página de login debe conservar el envío de credenciales.",
);

// El componente de shell debe seguir montando el sidebar.
mustContain(
  "components/layout/app-shell-router.tsx",
  ["AppSidebar", "<header"],
  "AppShellRouter debe montar el sidebar de navegación y el header.",
);

// ── Páginas "índice" que fueron sobrescritas en 77429df ──────────────────
// Cada una debe conservar su componente/propósito ÚNICO. Si alguna vuelve a
// quedar igual a su ruta hermana, mustNotDuplicate lo detecta.

mustContain(
  "app/app/master/page.tsx",
  ["Centro de Comando", "useOperationalPolling", "MANAGEMENT_LINKS"],
  "/app/master es el Centro de Comando (dashboard operativo). No debe ser la página de Usuarios/Personal & Roles (esa vive en master/users).",
);
mustContain(
  "app/app/branch/page.tsx",
  ["KpiCard", "RoleSummary"],
  "/app/branch es el dashboard 'Mi Sucursal' con KPIs. No debe ser el workspace de Despacho.",
);
mustContain(
  "app/app/master/production/page.tsx",
  ["Factory", "BatchSummary"],
  "/app/master/production es el panel 'Produccion Materiales' (lotes). No debe ser la página de Recetas (production/recipes).",
);
mustContain(
  "app/app/master/audit/page.tsx",
  ["AuditLogViewer"],
  "/app/master/audit es la 'Bitácora Global'. No debe ser la página de print-logs (audit/print-logs).",
);
mustContain(
  "app/app/master/catalog-inventory/page.tsx",
  ["CatalogInventoryAdmin"],
  "/app/master/catalog-inventory monta CatalogInventoryAdmin. No debe ser Product360 (esa requiere [id]).",
);
mustContain(
  "app/app/system-admin/page.tsx",
  ["SystemAdminDashboard"],
  "/app/system-admin es el Dashboard Admin. No debe ser la página de Configuraciones (system-admin/settings).",
);
mustContain(
  "app/app/page.tsx",
  ["AppIndexPage", "resolveRoleHome"],
  "/app debe redirigir al home según el rol. No debe renderizar otra página (p.ej. Configuraciones).",
);
mustContain(
  "app/page.tsx",
  ['redirect("/app")'],
  "/ (raíz) debe redirigir a /app. No debe ser la página de Sesión Requerida (unauthorized).",
);

// Pares ruta-índice vs ruta-hermana que NO deben ser idénticos (anti copy-paste).
mustNotDuplicate("app/app/master/page.tsx", "app/app/master/users/page.tsx",
  "El Centro de Comando se confundió con la página de Usuarios.");
mustNotDuplicate("app/app/master/production/page.tsx", "app/app/master/production/recipes/page.tsx",
  "El panel de Producción se confundió con la página de Recetas.");
mustNotDuplicate("app/app/master/audit/page.tsx", "app/app/master/audit/print-logs/page.tsx",
  "La Bitácora se confundió con Print Logs.");
mustNotDuplicate("app/app/master/catalog-inventory/page.tsx", "app/app/master/catalog-inventory/products/[id]/page.tsx",
  "Catálogo e Inventario se confundió con Product360.");
mustNotDuplicate("app/app/system-admin/page.tsx", "app/app/system-admin/settings/page.tsx",
  "El Dashboard Admin se confundió con Configuraciones.");
mustNotDuplicate("app/app/page.tsx", "app/app/system-admin/settings/page.tsx",
  "El índice /app se confundió con Configuraciones.");
mustNotDuplicate("app/page.tsx", "app/unauthorized/page.tsx",
  "La raíz / se confundió con la página de Sesión Requerida.");

// Páginas que hacen redirect: que ninguna apunte a sí misma.
[
  "app/app/master/timber/page.tsx",
  "app/app/master/timber/trips/page.tsx",
  "app/app/master/inventory/page.tsx",
  "app/app/master/employees/page.tsx",
  "app/app/master/catalog/products/page.tsx",
].forEach(noSelfRedirect);

/* ── Reporte ────────────────────────────────────────────────────────────── */
console.log(c.bold("\n🔎 Validando archivos críticos del frontend...\n"));

if (errors.length === 0) {
  console.log(c.green(`✓ OK — ${checked.length} archivos críticos verificados sin problemas.\n`));
  process.exit(0);
} else {
  console.log(c.red(c.bold(`✗ Se encontraron ${errors.length} problema(s) en archivos críticos:\n`)));
  for (const e of errors) console.log(c.red(e) + "\n");
  console.log(
    c.yellow(
      "Estos archivos son críticos: revísalos antes de hacer merge. Ver docs/ARCHIVOS_CRITICOS.md\n",
    ),
  );
  process.exit(1);
}
