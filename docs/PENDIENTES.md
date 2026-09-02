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

---

## Pendientes de la limpieza de código muerto (knip, 2026-09-02)

Estos ítems salieron del barrido de código muerto con knip
([docs/CODIGO-MUERTO.md](CODIGO-MUERTO.md)) pero no son limpieza de
código: son preguntas de producto/arquitectura que alguien con contexto
de negocio tiene que responder. Ninguno se resolvió borrando código.

### 4. Doble mecanismo de auto-cierre de caja

`cash-closure/scheduler.ts` arranca un `setInterval` de 60s en memoria
(vía `instrumentation.ts`) que hace lo mismo que el cron de Vercel cada
10 min contra `/api/system/cron/operational-automation`. Ambos llaman a
`autoCloseExpiredCashSessions`, que es idempotente, así que no hay bug —
pero es un mecanismo duplicado. ¿Vale la pena simplificar a uno solo (el
cron, que ya corre en el entorno serverless de todos modos) y retirar el
scheduler en memoria?

### 5. Rutas de cron sin cron configurado

`/api/system/cron/cash-auto-close` y
`/api/system/cron/operational-day-sweep` existen, tienen guards y lógica
real, pero no están en `vercel.json`. ¿Se supone que alguna corre
externamente (otro proveedor de cron, un webhook manual) o son
predecesoras de `operational-automation` que quedaron sin retirar?

### 6. ¿Brain reemplazó a `ai-insights`, o quedó abandonado?

5 rutas funcionales bajo `/api/ai-insights/*` sin ningún consumidor en el
frontend; `/app/master/ai-insights` es un redirect puro a
`/app/master/brain`. Si Brain ya cubre esta detección de anomalías,
`ai-insights` se puede borrar completo. Si no, es una feature a
terminar de conectar.

### 7. `cashier/v2` — asignar operadores adicionales a una sesión de caja

`v2/cash-boxes` y `v2/cash-sessions/operators` (asignar/revocar un
operador extra en una caja ya abierta) tienen backend completo
(transacción + audit log) pero nunca tuvieron pantalla — ni en v1 ni en
v2. ¿Se construye la UI, o se retira el backend?

### 8. Devoluciones y anulaciones de venta sin formulario de solicitud

Los árboles completos `/api/sales/returns/*` y
`/api/sales/cancellations/*` (10 rutas: listar, solicitar, aprobar,
ejecutar, rechazar) no tienen ningún punto de entrada en la UI para que
un usuario solicite una devolución o anulación — la única superficie
conectada es la cola genérica de aprobaciones (`approvals-queue.tsx`),
que actúa sobre solicitudes ya existentes, no las crea. Esto significa
que hoy, en la práctica, **nadie puede iniciar una devolución o
anulación formal desde la aplicación** salvo que se haga por otra vía no
identificada en este barrido. Dado que toca crédito de cliente y stock,
es el hallazgo de mayor impacto de negocio de todo este documento —
amerita confirmar con el dueño del producto si esto es un gap real o si
existe un camino de creación que este análisis no vio.

### 9. `/api/inventory/adjustments` — ajuste con aprobación, sin formulario

Mismo patrón que el punto 8 pero en inventario: existe un camino de
"ajustar a cantidad deseada, con aprobación si supera el umbral o falta
capability", separado de `manual-adjustment` (el que sí tiene UI), sin
ningún consumidor. ¿Cubre `manual-adjustment` todos los casos de uso
reales, o hace falta este segundo camino para roles sin
`INVENTORY_MOVEMENT_POST`?

### 10. Configuración de nómina (INSS/IR) sin pantalla de edición

`/api/payroll/rates` (GET config vigente + PATCH para editarla) no tiene
consumidor — el frontend calcula con constantes locales en vez de leer
esta config. Si el régimen INSS o el salario mínimo cambian (evento legal
real en Nicaragua), hoy requeriría un deploy de código en vez de una
edición desde Master. ¿Se construye la pantalla de configuración?

### 11. `hasAnyAssignedBranch` (rbac/guards.ts) sin reemplazo verificado

Knip lo marca sin uso, pero a diferencia de los otros 3 exports muertos
de ese archivo, no se encontró qué lo reemplazó ni evidencia de que sea
seguro borrarlo. Queda para revisar con más tiempo.

### 12. Dependencias de hammer-frontend sin evaluar

`docs/knip-baseline-frontend.txt` marca `eslint-config-next` y
`tailwindcss` como devDependencies sin uso, y `@eslint/eslintrc` como
dependencia no listada. No se tocó — es higiene de build/lint, fuera del
alcance de este barrido de código muerto en `src/`.

### 13. Parte D — sobre-exportación (cosmética, opcional)

~197 símbolos en hammer-api y 35 en hammer-frontend están exportados sin
necesidad (se usan solo dentro de su propio archivo). El arreglo es
sacar la palabra `export`, sin borrar lógica — bajo riesgo, baja
prioridad. No se ejecutó en esta pasada.
