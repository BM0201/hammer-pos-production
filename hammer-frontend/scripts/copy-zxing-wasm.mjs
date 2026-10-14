#!/usr/bin/env node
/**
 * E · Fase 1 (prompt-completo-pendientes-2026-10.md) — "el .wasm se copia a
 * public/vendor/zxing/ en el build, con un script en scripts/ o con
 * postinstall... Nunca desde un CDN." Corre como "postinstall" (package.json)
 * — así el binario queda en disco tanto en `npm install` local como en el
 * build de Vercel, sin commitear un binario de ~1 MB que de todos modos se
 * regenera en cada instalación (ver .gitignore).
 *
 * Solo copia el lector (zxing_reader.wasm) — esta app nunca ESCRIBE
 * códigos de barras con este módulo (eso lo hace qrcode/bwip-js en la hoja
 * de prueba de la Fase 3), así que el writer/full no hacen falta.
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "node_modules", "zxing-wasm", "dist", "reader", "zxing_reader.wasm");
const DEST_DIR = join(ROOT, "public", "vendor", "zxing");
const DEST = join(DEST_DIR, "zxing_reader.wasm");

const c = { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` };

if (!existsSync(SRC)) {
  // No-error exit: zxing-wasm es dependencia de "barcode-detector", que es
  // opcional en tiempo de ejecución (el motor nativo o el fallback zxing-js
  // cubren el escaneo si falta) — un postinstall que rompe `npm install`
  // completo por un asset opcional sería peor que el problema que evita.
  console.log(c.yellow(`⚠ copy-zxing-wasm: no se encontró ${SRC} — ¿cambió la estructura de paquetes de zxing-wasm? El motor WASM quedará inactivo (cae a zxing-js).`));
  process.exit(0);
}

mkdirSync(DEST_DIR, { recursive: true });
copyFileSync(SRC, DEST);
console.log(c.green(`✓ copy-zxing-wasm: ${DEST} actualizado desde node_modules/zxing-wasm.`));
