/**
 * verify-frontend-api-calls.ts
 *
 * Escanea componentes cliente buscando fetch() directo con métodos mutantes
 * (POST, PUT, PATCH, DELETE) que deberían usar apiFetch() en su lugar.
 *
 * Uso:  npx tsx scripts/verify-frontend-api-calls.ts
 * Sale con código 0 si todo está bien, 1 si hay problemas.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SCAN_DIRS = ["src/components", "src/app"];

/** Archivos excluidos con justificación */
const ALLOWED_EXCEPTIONS: Record<string, string> = {
  "src/components/login-form.tsx":
    "Llama /api/auth/login — no existe sesión aún, no aplica CSRF",
};

interface Issue {
  file: string;
  line: number;
  method: string;
  endpoint: string;
}

function scanFile(filePath: string): Issue[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const issues: Issue[] = [];

  // Buscar todas las posiciones de fetch( que NO sean apiFetch(
  const fetchRe = /(?<![a-zA-Z])fetch\s*\(/g;
  let fetchMatch: RegExpExecArray | null;

  while ((fetchMatch = fetchRe.exec(content)) !== null) {
    // Verificar que no es apiFetch
    const prefix = content.substring(Math.max(0, fetchMatch.index - 3), fetchMatch.index);
    if (prefix.toLowerCase().includes("api")) continue;

    // Mirar adelante hasta 400 caracteres para encontrar el method
    const lookahead = content.substring(fetchMatch.index, fetchMatch.index + 400);
    const methodMatch = lookahead.match(/method:\s*["']?(POST|PUT|PATCH|DELETE)["']?/i);

    if (methodMatch) {
      const lineNumber = content.substring(0, fetchMatch.index).split("\n").length;
      const endpointMatch = lookahead.match(/["`']([^"`']+)["`']/);
      issues.push({
        file: filePath,
        line: lineNumber,
        method: methodMatch[1].toUpperCase(),
        endpoint: endpointMatch?.[1] ?? "unknown",
      });
      continue;
    }

    // Verificar patrón de método variable: const method = editingId ? "PUT" : "POST"
    const varMethodMatch = lookahead.match(/method[,\s]/);
    if (varMethodMatch) {
      const before = content.substring(Math.max(0, fetchMatch.index - 300), fetchMatch.index);
      const constMethodMatch = before.match(/const method\s*=.*?(POST|PUT|PATCH|DELETE)/i);
      if (constMethodMatch) {
        const lineNumber = content.substring(0, fetchMatch.index).split("\n").length;
        const endpointMatch = lookahead.match(/["`']([^"`']+)["`']/);
        issues.push({
          file: filePath,
          line: lineNumber,
          method: "variable (PUT/POST)",
          endpoint: endpointMatch?.[1] ?? "unknown",
        });
      }
    }
  }

  return issues;
}

function walkDir(dir: string, ext: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, ext));
    } else if (ext.some((e) => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

async function main() {
  console.log("🔍 Escaneando componentes frontend por fetch() inseguro...\n");

  const files: string[] = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    files.push(...walkDir(abs, [".ts", ".tsx"]).map((f) => path.relative(ROOT, f)));
  }

  const allIssues: Issue[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (ALLOWED_EXCEPTIONS[file]) {
      skipped.push(`${file} → ${ALLOWED_EXCEPTIONS[file]}`);
      continue;
    }
    const fullPath = path.join(ROOT, file);
    const issues = scanFile(fullPath);
    allIssues.push(...issues);
  }

  // Reportar excepciones justificadas
  if (skipped.length > 0) {
    console.log("📋 Excepciones justificadas:");
    skipped.forEach((s) => console.log(`  ⏭️  ${s}`));
    console.log();
  }

  if (allIssues.length === 0) {
    console.log("✅ No se encontraron usos inseguros de fetch()");
    console.log("🎉 Todos los componentes usan apiFetch correctamente\n");
    process.exit(0);
  } else {
    console.log("❌ USOS INSEGUROS DE fetch() DETECTADOS:\n");
    allIssues.forEach((issue) => {
      console.log(`  ${issue.file}:${issue.line} — ${issue.method} ${issue.endpoint}`);
    });
    console.log(`\n⚠️  Total: ${allIssues.length} usos inseguros`);
    console.log("💡 Migre estos componentes a apiFetch\n");
    process.exit(1);
  }
}

main();
