#!/usr/bin/env node
/**
 * inject-sw-cache-version.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * prompt-sw-cache-version.md — la raíz real del bug de "el despliegue nuevo
 * no se ve": public/sw.js declaraba `const CACHE = "hammer-pos-vN"` como un
 * string fijo que dependía de que alguien se acordara de subir el número EN
 * CADA despliegue. Este script corre como "postbuild" (ver package.json —
 * mismo mecanismo de hook de npm que ya usa "prebuild" en este package, no
 * un mecanismo nuevo) DESPUÉS de cada `next build`, y reescribe ese valor
 * con el buildId real que Next.js genera (único por compilación, escrito en
 * .next/BUILD_ID) — así cada despliegue invalida el caché viejo solo, sin
 * que nadie tenga que recordarlo.
 *
 * No inventa un mecanismo de versionado nuevo: usa el buildId que Next.js
 * YA expone (sin `generateBuildId` propio en next.config.ts, Next.js genera
 * uno único por build automáticamente).
 *
 * Falla con código 1 (rompe el build) ante CUALQUIER cosa inesperada — sw.js
 * mal escrito y desplegado en silencio es exactamente el bug que este
 * script existe para eliminar, así que "seguir de largo" nunca es la
 * opción segura acá. La única salida temprana con código 0 es la genuina:
 * este script solo se invoca vía "postbuild" (nunca a mano en uso normal),
 * y `next build` SIEMPRE escribe .next/BUILD_ID al terminar con éxito — si
 * postbuild corrió, BUILD_ID existe. La única forma real de llegar acá sin
 * él es correr este script manualmente sin haber compilado antes.
 *
 * Uso:
 *   next build && node scripts/inject-sw-cache-version.mjs
 *   (automático vía "postbuild" en npm run build — no hace falta invocarlo a mano)
 *
 * Efecto secundario esperado: un `npm run build` local deja public/sw.js
 * modificado en el working tree (el valor commiteado es solo el default de
 * `npm run dev`, que nunca corre este script). Es intencional — revertir
 * con `git checkout -- public/sw.js` si molesta; no afecta a Vercel, que
 * construye desde un checkout limpio en cada despliegue.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BUILD_ID_PATH = join(ROOT, ".next", "BUILD_ID");
const SW_PATH = join(ROOT, "public", "sw.js");

// Alfanumérico + "-"/"_" — el formato real que genera Next.js hoy (ver los
// valores de ejemplo en el commit que introdujo este script:
// "ZyTKrIukUylDx6KMXUfV5", "NIcHR9dFfhWEsRSNdoH_8"). No es solo cosmético:
// buildId se empalma directo dentro de un string entre comillas dobles en
// sw.js — cualquier comilla o salto de línea ahí produciría JavaScript
// inválido, desplegado en silencio. Si un futuro Next.js cambia el formato,
// esto falla ALTO en vez de escribir sw.js corrupto sin que nadie lo note.
const SAFE_BUILD_ID = /^[A-Za-z0-9_-]+$/;
const CACHE_LINE = /const CACHE = "[^"]*";/g;

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

function fail(message) {
  console.error(c.red(`✗ inject-sw-cache-version: ${message}`));
  process.exit(1);
}

if (!existsSync(BUILD_ID_PATH)) {
  // Única salida temprana no-error — ver el porqué en el comentario de
  // cabecera. No es "postbuild corrió y algo falló", es "esto se invocó
  // fuera del flujo normal, sin compilar antes".
  console.log(c.yellow(`⚠ inject-sw-cache-version: no se encontró ${BUILD_ID_PATH} — ¿se corrió este script sin \`next build\` antes? public/sw.js queda con su valor commiteado.`));
  process.exit(0);
}

const buildId = readFileSync(BUILD_ID_PATH, "utf8").trim();
if (!SAFE_BUILD_ID.test(buildId)) {
  fail(`${BUILD_ID_PATH} contiene "${buildId}" — no es un buildId con el formato esperado (alfanumérico, "-", "_"). No se escribe sw.js con un valor sin validar.`);
}

if (!existsSync(SW_PATH)) {
  fail(`no se encontró ${SW_PATH}.`);
}

const original = readFileSync(SW_PATH, "utf8");
const matches = original.match(CACHE_LINE) ?? [];
if (matches.length === 0) {
  fail(`no se encontró la línea \`const CACHE = "...";\` en ${SW_PATH} — revisar si sw.js cambió de forma.`);
}
if (matches.length > 1) {
  fail(`${SW_PATH} tiene ${matches.length} líneas \`const CACHE = "...";\` — se esperaba exactamente una. Revisar el archivo antes de reescribirlo (el .replace de abajo solo tocaría la primera y dejaría el resto con un valor viejo, sin avisar).`);
}

const nextCache = `hammer-pos-${buildId}`;
const updated = original.replace(CACHE_LINE, `const CACHE = "${nextCache}";`);
writeFileSync(SW_PATH, updated, "utf8");

console.log(c.green(`✓ inject-sw-cache-version: public/sw.js → CACHE = "${nextCache}" (buildId de .next/BUILD_ID)`));
