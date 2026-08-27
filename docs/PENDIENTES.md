# Pendientes abiertos — inventario

Registro de trabajo marcado en prompts anteriores y verificado en el código
como NO implementado a la fecha de este documento (2026-08-27, rama
`Hammer-V1`, sobre el commit `7fdd9b8`). Existe para que estos pendientes
dejen de vivir solo en el historial de una conversación.

**Ninguno de los ítems de abajo se implementó en este ciclo** — es
inventario, no ejecución.

---

## 1. Confirmación de recepción del efectivo en tránsito

**Prioridad: la más alta.** Es el hueco más grande que queda abierto en
Tesorería.

Hay caminos que dejan dinero a nombre de alguien (`sendCashOutToCustody`,
las variantes "yo lo llevo al banco" / "yo se lo llevo a alguien" /
"otra persona lo lleva" del módulo Destino del efectivo) y **ninguno tiene
el otro lado**: falta el "recibí C$X de `<persona>`" que transfiere la
custodia. El dinero sale de la gaveta, queda registrado en una cuenta
`CUSTODY`, y se queda ahí hasta que Master lo mueve a mano — no hay un
flujo donde el receptor (Master, otro cajero, quien sea) confirme que
efectivamente lo recibió.

Verificado: no existe ningún endpoint ni función `confirmCustodyReceipt`/
`receiveCash`/equivalente en `hammer-api/src/modules/treasury/` ni en
`hammer-api/src/app/api/`.

## 2. Destello de tema en terminal compartida

`POST /api/auth/login` (`hammer-api/src/app/api/auth/login/route.ts`)
devuelve `{ redirectTo, mustChangePassword, fullName }` en el éxito — sin
`userId` ni `themePreference`. Sin esos dos datos, `applyUserTheme` (el
lado del frontend que fija el tema ANTES de pintar la pantalla) no puede
correr antes de `playTransition`, así que en una terminal compartida
(usuario A en claro, sale, usuario B entra) la pantalla parpadea con el
tema del usuario anterior una fracción de segundo antes de corregirse al
tema correcto.

Verificado contra el código actual del route: el objeto de éxito no trae
esos dos campos.

## 3. Cierre de caja con posposición activa

El modal de declaración de destino al cierre (`cash-session/
cash-destination-declaration-modal.tsx`) vuelve a preguntar qué hacer con
efectivo que **ya se pospuso** durante la sesión (vía "se queda en la
gaveta hasta mañana" / `postponeCashDeposit`), sin prefill del monto ya
comprometido ni del motivo que se declaró en ese momento. El cajero
termina re-declarando lo mismo dos veces, o el cierre no refleja el
compromiso que ya existía.

Verificado: ningún componente bajo `hammer-frontend/src/components/
cash-session/` referencia `CashDepositPostponement`/posposiciones.

---

## Ítems del prompt original que YA ESTABAN RESUELTOS (no se incluyen arriba)

El prompt que originó este inventario listaba dos ítems adicionales que,
al verificar el código actual, ya estaban implementados — ambos en el
commit `d1ebcd5` (`feat(pos): cinco destinos para el efectivo y barra que
no se trunca`), de una fase anterior de esta misma rama de trabajo:

- **Barra de Destino del efectivo con `truncate`/`uppercase`** (el "FO...
  C..." de la captura original): la barra actual (`hammer-frontend/src/
  app/app/branch/cash-destination/page.tsx`) es de 14px sin texto adentro,
  con una leyenda en sentence case debajo — no queda ningún `truncate` ni
  `uppercase` en ese bloque.
- **Cinco opciones agrupadas + sheet con cuatro variantes**: el
  `SheetKind` (`SELF_TO_BANK | OTHER_TO_BANK | HANDOVER_HERE |
  SELF_TO_PERSON | POSTPONE`), los tres grupos ("Va al banco" / "Va con
  una persona" / "No sale hoy") y el sheet único con las cuatro variantes
  ya están en el archivo.

Se anota acá en vez de omitirse en silencio, para que nadie vuelva a
marcarlos como pendientes a partir de una versión vieja de este
documento o de la memoria de una conversación anterior.
