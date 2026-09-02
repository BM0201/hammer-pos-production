# Código muerto — inventario de limpieza (knip)

Regla que gobernó todo este trabajo: **un borrado que rompe algo cuesta más
que todo el código muerto junto. Ante cualquier duda, no se borró — se
anotó acá y se siguió.** Por eso este documento tiene dos partes, y la
segunda (lo que NO se borró) importa tanto o más que la primera.

Herramienta: [knip](https://knip.dev) 6.34.0, configurado en
`hammer-api/knip.json` y `hammer-frontend/knip.json`. Evidencia cruda en
[docs/knip-baseline-api.txt](knip-baseline-api.txt) y
[docs/knip-baseline-frontend.txt](knip-baseline-frontend.txt) — el estado
ANTES de tocar nada. Donde knip y un análisis por regex anterior no
coincidían, ganó knip. knip analiza exports sin importador en todo el
proyecto; **no** analiza rutas de API (son entry points por definición en
Next.js) — la Parte C de este documento es investigación manual, no un
reporte de la herramienta.

Metodología para exports marcados "sin uso" por knip: se contó cuántas
veces aparece el símbolo dentro de su propio archivo. Si solo aparece una
vez (la propia declaración) → **DELETE**, código genuinamente muerto en
todo el proyecto. Si aparece más de una vez → **DEFER**, lo usa código
hermano del mismo archivo — no está muerto, solo sobre-exportado (Parte D,
opcional, cosmética — sacarle `export` sin borrar nada).

## Qué se borró

### Parte A — módulos huérfanos y migraciones archivadas (`abdee05`)

- `hammer-api/src/modules/brain/prediction/demand-forecast.ts`
- `hammer-api/src/modules/brain/prediction/reorder-simulation.ts`
- `hammer-api/src/modules/operations/schedule-info.ts`
- `hammer-api/prisma/migrations_archived/` (10 carpetas) — Prisma no lee
  ese directorio; el historial de git preserva el contenido.

`cash-closure/scheduler.ts`, el cuarto candidato de esta parte, se
investigó primero y **no se borró** — ver la sección de abajo.

### Parte B — exports sin uso, módulo por módulo

Un commit por módulo (`fbe8d6c` → `539470a` en hammer-api,
`31dbc32` en hammer-frontend), cada uno con `tsc --noEmit` limpio y la
suite completa en 1090/1091 (única falla preexistente, sin relación,
`fusion-composition.test.ts`) antes de cada commit — con la excepción del
commit de `import-excel` (Parte C), que bajó el conteo a 1080/1081 porque
borró un archivo de test completo junto con el módulo que probaba.

**hammer-api** (72 símbolos, mapeados 1:1 con la evidencia en
knip-baseline-api.txt):

| Módulo | Commit | Qué se borró |
|---|---|---|
| catalog | `fbe8d6c` | alias `reinterpretEquivalentStockGroupTx`, `COMMON_PRESENTATION_UNITS`, 2 wrappers de stock-group-crud |
| timber | `6439d4d` | 2 schemas y 3 tipos sin uso en validators.ts; `STANDARD_MEASURES`, `TimberType`, `TIMBER_CONSTANTS` en calculator.ts |
| reorder | `e487204` | `dismissAlert`, `evaluateReorderNeeds` (332 líneas, comentario `@deprecated` falso — verificado por grep que su tipo de retorno NO se usaba en ningún lado, a pesar de lo que decía el comentario), `convertBatchToPurchaseOrder` (bug de doble IVA autodocumentado), `convertBatchToTransfer`; en validators.ts, labels y schemas de evaluación sin uso |
| pricing | `f76ceb9` | labels y tipos de validators.ts; `getProductPricingHistory` (tabla `productPricing`, distinta del historial por audit-log); `calculateSuggestedPriceSimple` |
| payroll | `0a7e267` | `calculateProratedSalary` (duplicado literal de `calculateMonthlyPayroll`), `getActiveEmployees`, tipo `RollCallReviewStatus` |
| inventory | `d8e45fc` | `DraftSummary`, `resolveReplenishmentParams` (superada por la variante Batch), `listInventoryMovements` (superada por `...Paginated`) |
| cash-closure | `4700705` | `stopCashClosureScheduler` — **no** el archivo completo, ver abajo |
| security | `486d8a5` | `cleanupExpiredCsrfTokens`, `cleanupOldAttempts`, `cleanupExpiredRevocations`, `cleanupExpiredMfaTokens` — las 4 superadas por `/api/cron/cleanup`, que borra los mismos registros directo con Prisma (verificado leyendo el body de esa ruta) |
| misc (13 archivos sin relación entre sí) | `7d79d70` | `ApiResponse` type, 4 helpers de `ai-insights/analyzer.ts`, `getBulkDynamicPrices`, `assertOwner` duplicado en auth/access.ts, `describeWorkflow`, 3 tipos `z.infer<>` huérfanos, `getInternalFreightTrip`, `recalculateCustomerCreditScore` (wrapper; la versión interna `...Tx` sigue viva), `positiveIntSchema`+`MAX_INT`, `countPendingTransports`, `listBankAccountsWithBalances` (superada por `...AndCards`), `listActiveBranches`, `requireBranchWorkflowCapability`, `ModuleFlags` |
| rbac | `539470a` | `hasPermission`, `hasCapability`, `hasCapabilityInBranch` en guards.ts; `assertSystemAdmin`, `assertOwnerOrSystemAdmin`, `getAllowedBranchIds`, `canAccessBranch` en rbac-helpers.ts — ver investigación completa abajo |

**hammer-frontend** (8 símbolos, `31dbc32`): `CardHeader`/`CardFooter`
(card.tsx), `DispatchVisualStatus` (pos-ui.ts), `RollCallStatus`
(attendance-roll-call-modal.tsx), `getRoleAccentStyles` (role-colors.ts),
`colors`/`spacing`/`typography` (design-system.ts — `colors` había dado un
falso positivo de "en uso" por un grep automático que matcheó la clase de
Tailwind `transition-colors`; se verificó a mano antes de borrar).

### Parte C — rutas de API sin consumidor

- **`d5d278a`** — `/api/master/dashboard` (GET). Cero consumidores;
  `/app/master/page.tsx` llama a `/api/master/command-center` en su lugar,
  un snapshot más completo. Se borró solo `getMasterDashboardSummary` de
  `dashboard/service.ts`; sus 4 funciones hermanas siguen vivas (las usa
  `/api/branch/dashboard`).
- **`c68d2ae`** — `/api/master/import/excel` completa, más
  `modules/import-excel/service.ts`, `import-hmac.ts` e
  `import-hmac.test.ts`. Cero consumidores; la pantalla real de
  importación (`catalog-inventory-admin.tsx`) usa
  `/api/master/catalog-inventory/import`, un módulo completamente
  distinto que ni siquiera firma batches con HMAC. **Esto resuelve la
  pregunta pendiente de la sesión anterior**: el riesgo de precios en
  `import-excel/service.ts:186` (escritura de `standardSalePrice`) vivía
  en código muerto, inalcanzable — no en el módulo que la app usa de
  verdad. `excel-reader.ts` no se tocó: lo importa el módulo vigente.

## Qué NO se borró (y por qué) — el mapa de lo que hay que investigar después

### Redundancia real, no abandono: `cash-closure/scheduler.ts`

Investigado ANTES de tocar nada, tal como pedía la Parte A.1. La pregunta
era: ¿el auto-cierre de caja corre de verdad? Sí, dos veces:

1. `instrumentation.ts` arranca `startCashClosureScheduler()` al boot del
   proceso Node — un `setInterval` de 60s en memoria.
2. `vercel.json` tiene un cron real cada 10 min contra
   `/api/system/cron/operational-automation`.

Ambos caminos terminan llamando a la MISMA función idempotente
(`autoCloseExpiredCashSessions`). No es una funcionalidad que nunca se
conectó (el escenario que la Parte A.1 quería evitar borrar por error) ni
código muerto — es un mecanismo duplicado que corre en paralelo sin
romper nada porque es idempotente. Se dejó todo el archivo intacto; solo
se borró `stopCashClosureScheduler`, que sí estaba genuinamente sin uso.
Pendiente de decisión de producto: ¿vale la pena simplificar a un solo
mecanismo? Ver [docs/PENDIENTES.md](PENDIENTES.md).

### Rutas de cron sin cron configurado

`/api/system/cron/cash-auto-close` y
`/api/system/cron/operational-day-sweep` **no** están en `vercel.json` —
solo `operational-automation` (cada 10 min) y `/api/cron/cleanup`
(diario 9am UTC) lo están. Por la regla de la Parte C.1, esta ausencia
ES el hallazgo, no algo para limpiar borrando la ruta: son rutas
funcionales, con guards y lógica real, que hoy nadie invoca. No se
tocaron.

### Dos generaciones de guards RBAC — investigado a fondo antes de tocar una sola línea

La Parte B.1 pedía explícitamente confirmar cuál generación de guards está
vigente antes de borrar, porque un guard de permisos borrado por error
"abre un agujero de seguridad silencioso". Evidencia reunida:

- `rbac/guards.ts` es la base viva de TODO el sistema de permisos
  (`isMaster`, `isOwner`, `hasBranchAccess`, `canInBranch`,
  `CAPABILITIES`) — no es un módulo legacy, lo usa cada ruta de API.
- `auth/access.ts` (306 archivos de ruta lo importan) es la generación
  VIGENTE de asserts.
- `security/rbac-helpers.ts` (solo 15 archivos) es una SEGUNDA
  generación de los mismos asserts, parcialmente adoptada: `assertOwner`,
  `assertMaster`, `assertBranchAccess`, `assertFinanceAccess` sí tienen
  uso real y se quedan; 4 exports nunca se adoptaron y se borraron
  (`assertSystemAdmin`, `assertOwnerOrSystemAdmin` — redundante por
  diseño, `isOwner()` ya incluye `isSystemAdminRole()` —,
  `getAllowedBranchIds`, `canAccessBranch`).

De `rbac/guards.ts` se borraron 3 (`hasPermission`, `hasCapability`,
`hasCapabilityInBranch` — cada uno con un reemplazo verificado en uso
real). **`hasAnyAssignedBranch` NO se borró**: no se encontró un
reemplazo verificado en uso en ningún lado del código. Queda para
investigar.

### Un "v2" que reemplazó una parte de "v1", no todo — `cashier/v2/*`

La Parte C.2 pedía confirmar cuál generación está en uso y borrar la otra
completa. La realidad resultó ser más matizada que un binario v1-vs-v2:

- `v2/cash-movements` — SÍ tiene consumidor (`cash-movements-panel.tsx`),
  vigente.
- `v2/cash-boxes` (dashboard enriquecido de cajas con operadores) y
  `v2/cash-sessions/operators` (asignar/revocar un operador adicional a
  una sesión ya abierta, con `assignCashSessionOperator`/
  `revokeCashSessionOperator`) — **cero consumidores**, confirmado con
  grep exhaustivo en todo `hammer-frontend/src`, sin coincidencias ni
  siquiera por segmento de ruta suelto.

Pero no es v1 vs v2: v1 tampoco tiene una pantalla de "operadores
múltiples por sesión de caja" — el único punto de escritura real de
`CashSessionOperator` en producción es la asignación automática del
`OWNER_OPERATOR` al abrir la caja (`cash-session/service.ts:188`). Es
decir: la función de asignar operadores adicionales es una feature de
backend completa (transacción, audit log) que **nunca tuvo pantalla, ni
en v1 ni en v2** — no un reemplazo abandonado. No se borró; es una
decisión de producto (¿se construye la pantalla, o se retira el
backend?), no una limpieza de código muerto.

### Aprobaciones sin formulario de creación — `sales/returns` y `sales/cancellations`

Hallazgo grande, no anticipado por el spec original. Los árboles
completos `/api/sales/returns/*` y `/api/sales/cancellations/*` (10
rutas: listar, crear, aprobar, ejecutar, rechazar, por id) tienen **cero**
consumidores en todo `hammer-frontend`. Nada en la UI menciona
`SaleReturn`/`SaleCancellation`. Lo único que toca este dominio en el
frontend es `approvals-queue.tsx`, que llama al endpoint genérico
`/api/approvals/[id]` — type-agnostic, no pasa por estas 10 rutas
específicas.

Esto es lógica de negocio real y sensible (recalcula el credit score del
cliente al aceptar una devolución) con capability checks propios,
completa en el backend, sin ningún punto de entrada en la UI para que un
cajero o vendedor solicite una devolución o anulación formalmente. No se
borró nada de este árbol — es la clase de hallazgo que la regla de este
documento existe para proteger: fácil de leer como "muerto" por knip/grep,
en realidad una funcionalidad de producto que nunca se conectó del todo.

### Config de nómina sin pantalla — `/api/payroll/rates`

GET/PATCH de la configuración de nómina (régimen INSS, modo de
prestaciones, salario mínimo, tabla IR Ley 822). Cero consumidores: el
frontend (`payroll-calc.ts` y el resto del módulo de Finanzas) replica la
lógica de cálculo localmente en vez de leerla de esta ruta. No hay
pantalla de configuración en Master para editar estos valores. Dado que
es config fiscal/legal, se documentó en vez de borrarse — perder la única
vía de edición (aunque no tenga UI hoy) sin verificar primero si hay un
plan para construirla es exactamente el tipo de borrado irreversible que
la regla de este documento pide evitar.

### Vista de stock cross-sucursal sin consumidor — `/api/inventory/product-stocks`

Cero consumidores confirmados. El propio archivo tiene un comentario de
auditoría de seguridad fechado 2026-08-03 señalando que el endpoint no
filtra por capability de sucursal — evidencia de que alguien lo revisó
recientemente. No se encontró una ruta reemplazante equivalente (el
inventario por sucursal se sirve por otros caminos, como
`stock-groups`). Se documenta en vez de borrarse, dado que no hay
evidencia de "superada por X", solo de "sin consumidor hoy".

### `/api/inventory/adjustments` — no es un duplicado de `manual-adjustment`

A diferencia de `master/dashboard`, esta NO es una simple sustitución.
`manual-adjustment` (vigente, usado en `catalog-inventory-admin.tsx`)
registra un movimiento directo por tipo (ADJUSTMENT_OUT/DAMAGE/
RETURN_IN/ADJUSTMENT_IN). `adjustments` (sin consumidor) es un mecanismo
distinto: recibe una "cantidad deseada" y, según un umbral y la
capability `APPROVAL_REQUEST_CREATE`, ejecuta directo o crea una
solicitud de aprobación vía `requestStockAdjustment` — el mismo patrón de
"aprobación sin formulario en la UI" que `sales/returns`/
`sales/cancellations`. No se borró: no hay evidencia de que
`manual-adjustment` cubra el mismo caso de uso (usuarios sin
`INVENTORY_MOVEMENT_POST` que necesitarían pasar por aprobación).

### Todo el módulo `/api/ai-insights/*`

5 rutas funcionales (`anomalies`, `discount-suggestions`, `discrepancies`,
`patterns`, `refresh`), sin stub 410, sin ningún llamador en el frontend.
`/app/master/ai-insights` es un redirect puro a `/app/master/brain`. No
se determinó si Brain reimplementó esta detección de anomalías o si la
funcionalidad quedó abandonada — es una decisión de producto, no de
limpieza de código. Solo se borraron 4 helpers matemáticos sin ningún uso
ni siquiera interno dentro de `ai-insights/analyzer.ts` (`median`,
`coefficientOfVariation`, `dayBounds`, `severityScore`); el resto del
módulo permanece intacto.

### Otros, ya documentados en los commits de sus módulos

- `catalog-inventory/service.ts`: `resolveCatalogDisplayCostBatch` — sin
  llamadores hoy, pero probada (`catalog-display-cost.test.ts`) y
  autodocumentada como código de reserva "para quien la necesite".
- `cameras/credentials-crypto.ts`: `generateCameraCredentialsKey` — su
  propio comentario la describe como utilidad de aprovisionamiento
  única, no una función de uso normal de la app.
- `cameras/service.ts`: `decryptCameraCredentialsFor` — se dejó por
  prudencia, dado que es código de manejo de credenciales.
- `rbac/effective-permissions.ts`: `isBranchRoleEnabled` — adyacente a
  permisos, se dejó para investigar junto con el resto de RBAC.

## Parte D — sobre-exportación (no ejecutada, opcional, cosmética)

316 símbolos en hammer-api (197 tras la reclasificación real; ver conteo
por módulo en los commits de Parte B) y 35 en hammer-frontend están
marcados "DEFER": se usan dentro de su propio archivo, pero knip los
marca porque nadie los importa desde afuera. No es código muerto, es
superficie de API más ancha de lo necesario. El arreglo (sacar la palabra
`export`, sin borrar ni una línea de lógica) es de bajo riesgo pero baja
prioridad — no se ejecutó en esta pasada porque las Partes A–C ya
cubrieron el objetivo de la limpieza y el tiempo se priorizó ahí, tal
como el spec original marcaba esta parte como "hacer solo si sobra
tiempo, sin riesgo".

## Dependencias de hammer-frontend (no evaluadas)

`docs/knip-baseline-frontend.txt` también marca 2 devDependencies sin uso
(`eslint-config-next`, `tailwindcss`) y 1 dependencia no listada
(`@eslint/eslintrc`). Es higiene de `package.json`, no código muerto en
`src/`, y toca tooling de build/lint — fuera del alcance de este barrido;
queda anotado acá en vez de tocado a ciegas.
