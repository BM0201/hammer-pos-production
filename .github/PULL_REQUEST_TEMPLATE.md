<!--
  Plantilla de Pull Request — Hammer POS
  Completa el checklist antes de pedir revisión. No borres las secciones.
-->

## 📋 Descripción

<!-- ¿Qué cambia este PR y por qué? Enlaza el issue si aplica. -->


## 🔧 Tipo de cambio

- [ ] 🐛 Bugfix (corrige un problema sin romper compatibilidad)
- [ ] ✨ Feature (nueva funcionalidad)
- [ ] ♻️ Refactor (sin cambios de comportamiento)
- [ ] 🎨 Estilo/UI
- [ ] 🧹 Chore / mantenimiento
- [ ] 📝 Documentación

## ✅ Checklist obligatorio

- [ ] `npm run typecheck` pasa sin errores
- [ ] `npm run lint` pasa sin errores
- [ ] `npm run validate:critical` pasa (integridad de archivos críticos)
- [ ] `npm run test:unit` pasa
- [ ] `npm run build` compila correctamente
- [ ] Probé manualmente el flujo afectado (incluyendo **navegación tras login**)

## ⚠️ Archivos críticos (revisión reforzada)

> Si este PR toca alguno de estos archivos, **explica el motivo** y pide doble revisión.
> Ver `docs/ARCHIVOS_CRITICOS.md`.

- [ ] **No** modifiqué archivos críticos, **o**
- [ ] Modifiqué archivo(s) crítico(s) y lo justifico abajo:

<!-- Justificación de cambios en archivos críticos: -->


## 🧪 ¿Cómo se probó?

<!-- Pasos para reproducir/verificar. Capturas si es UI. -->


## 🚫 Evitar commits-escoba

- [ ] Este PR tiene un alcance **acotado y coherente** (no mezcla cambios no relacionados).
- [ ] Revisé el `git diff` completo y **ningún archivo quedó vaciado por accidente**.

<!--
  Recordatorio: el incidente de /app/master (sidebar/header perdidos) y el
  bucle de timber se originaron en un commit "chore: pending changes..." que
  vació archivos sin querer. Mantén los PRs pequeños y revisa el diff.
-->
