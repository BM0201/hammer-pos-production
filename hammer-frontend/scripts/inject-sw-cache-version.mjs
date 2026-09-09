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

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

if (!existsSync(BUILD_ID_PATH)) {
  console.log(c.yellow(`⚠ inject-sw-cache-version: no se encontró ${BUILD_ID_PATH} — ¿corrió esto antes que \`next build\`? public/sw.js queda con su valor commiteado.`));
  process.exit(0);
}

const buildId = readFileSync(BUILD_ID_PATH, "utf8").trim();
if (!buildId) {
  console.error(c.red(`✗ inject-sw-cache-version: ${BUILD_ID_PATH} existe pero está vacío.`));
  process.exit(1);
}

if (!existsSync(SW_PATH)) {
  console.error(c.red(`✗ inject-sw-cache-version: no se encontró ${SW_PATH}.`));
  process.exit(1);
}

const original = readFileSync(SW_PATH, "utf8");
const cachePattern = /const CACHE = "[^"]*";/;
if (!cachePattern.test(original)) {
  console.error(c.red(`✗ inject-sw-cache-version: no se encontró la línea \`const CACHE = "...";\` en ${SW_PATH} — revisar si sw.js cambió de forma.`));
  process.exit(1);
}

const nextCache = `hammer-pos-${buildId}`;
const updated = original.replace(cachePattern, `const CACHE = "${nextCache}";`);
writeFileSync(SW_PATH, updated, "utf8");

console.log(c.green(`✓ inject-sw-cache-version: public/sw.js → CACHE = "${nextCache}" (buildId de .next/BUILD_ID)`));
