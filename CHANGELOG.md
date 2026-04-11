# CHANGELOG — H.A.M.M.E.R. POS ADMIN v1.0.2

## [1.0.2] — 2026-04-09

### 🧠 Panel de Análisis Inteligente (AI Insights)

#### Nuevo módulo: `src/modules/ai-insights/`
- **analyzer.ts**: Utilidades estadísticas (Z-Score, IQR, regresión lineal, coeficiente de variación)
- **discount-optimizer.ts**: Motor de sugerencias de descuentos inteligentes
  - Productos con baja rotación + stock disponible
  - Productos con alto margen que soportan promociones
  - Inventario estancado (>60 días) con descuentos de urgencia
  - Patrones temporales (descuentos en días débiles)
- **anomaly-detector.ts**: Detección de anomalías con Z-Score e IQR
  - Volumen de ventas por hora inusual
  - Transacciones con montos extremos
  - Precios de venta anómalos vs promedio
  - Inventario negativo/cero con actividad reciente
  - Cajeros con tickets o descuentos fuera de rango
  - Sucursales con métricas fuera de norma
- **discrepancy-detector.ts**: Identificación de discrepancias
  - Descuentos inusuales (>30% o >2.5σ)
  - Posibles transacciones duplicadas (<5 min, mismo monto)
  - Inconsistencias de precio vs lista
  - Patrones de devoluciones anómalas
  - Desviaciones entre sucursales
- **pattern-analyzer.ts**: Análisis de patrones y comportamientos
  - Market Basket Analysis (co-ocurrencia, soporte, confianza, lift)
  - Patrones temporales (días fuertes/débiles, horas pico)
  - Tendencias de demanda (regresión lineal con R²)
  - Eficiencia comparativa de vendedores
  - Recomendaciones de negocio (tendencia, stock crítico, tasa de descuentos)
- **service.ts**: Capa de servicio con caché en memoria (TTL 15 min)

#### API Endpoints
- `GET /api/ai-insights/discount-suggestions` — Sugerencias de descuento
- `GET /api/ai-insights/anomalies` — Anomalías detectadas
- `GET /api/ai-insights/discrepancies` — Discrepancias en datos
- `GET /api/ai-insights/patterns` — Patrones y recomendaciones
- `POST /api/ai-insights/refresh` — Recalcular todos los insights

#### Dashboard de Master
- Nueva página: `/app/master/ai-insights/page.tsx`
- Tarjetas de resumen: sugerencias, alertas, anomalías, patrones, recomendaciones
- Filtros por sucursal y período (7/14/30/60/90 días)
- Cards expandibles con detalles, métricas e impacto estimado
- Botón de recalcular para forzar análisis fresco
- Sección informativa de algoritmos utilizados

#### Navegación
- Enlace "Análisis Inteligente" (ícono Brain) agregado al sidebar en secciones MASTER y SYSTEM_ADMIN

#### Documentación
- README completo en `src/modules/ai-insights/README.md`
- Descripción de algoritmos, tipos de insights, interpretación de resultados

---

### 🔒 Sistema de Cierre Automático de Caja (5:30 PM Nicaragua GMT-6)

#### Servicio de Cierre (`src/modules/cash-closure/service.ts`)
- **Cierre automático diario**: Calcula y guarda totales de ventas del día por sucursal a las 17:30 hora Nicaragua
- **Cálculo de totales**: Total vendido, número de transacciones, desglose por método de pago (efectivo, tarjeta, transferencia, crédito, mixto), productos vendidos
- **Cierre de sesiones**: Cierra automáticamente todas las sesiones de caja abiertas (`OPEN`, `RECONCILING`) → `AUTO_CLOSED`
- **Reporte JSON**: Genera reporte detallado con listado de órdenes, montos y métodos de pago
- **Registro de auditoría**: Cada cierre genera entrada en `AuditLog` y `CashClosureLog`

#### Scheduler (`src/modules/cash-closure/scheduler.ts`)
- Verifica cada 60 segundos si es hora de cerrar (17:30 GMT-6)
- Control de ejecución única diaria (no re-ejecuta si ya cerró hoy)
- Se inicia automáticamente al arrancar el servidor Next.js vía `instrumentation.ts`

#### API Endpoints
- `POST /api/cash-closure` — Disparar cierre manual (MASTER/SYSTEM_ADMIN)
- `GET /api/cash-closure/status?branchId=` — Consultar estado de cierre del día
- `POST /api/cash-closure/reopen` — Reapertura de emergencia
- `GET /api/cash-closure/reports` — Reportes de cierre con filtros

#### Integración con Ventas
- `createDraftSaleOrder()` verifica `canSell` antes de crear nuevas órdenes
- Bloquea nuevas ventas si la caja está cerrada o permanentemente cerrada
- Registra ventas de emergencia después de reapertura en `postSaleOrderPayment()`

---

### 🔓 Sistema de Reapertura de Emergencia

- **Roles autorizados**: Solo `MASTER` y `BRANCH_ADMIN` pueden reabrir la caja
- **Contador de ventas**: Máximo 3 ventas adicionales después de la reapertura
- **Cierre permanente**: Al alcanzar 3 ventas de emergencia, ejecuta cierre que no se puede reabrir hasta el día siguiente
- **Restricción por sucursal**: `BRANCH_ADMIN` solo puede reabrir su propia sucursal
- **Log completo**: Todas las reaperturas y ventas de emergencia quedan registradas en `CashClosureLog`
- **Cierre de sesiones**: Al cierre permanente, sesiones se marcan como `PERMANENTLY_CLOSED`

---

### 📊 Dashboard de Master — Reportes de Cierre

#### Página (`src/app/app/master/cash-closure-reports/page.tsx`)
- **Lista de cierres**: Muestra todos los cierres por sucursal y fecha con detalle expandible
- **Tarjetas resumen**: Ventas totales, transacciones, número de cierres, reaperturas
- **Alertas de reapertura**: Sección destacada con alertas amber para reaperturas de emergencia
- **Detalle expandible**: Desglose de métodos de pago, productos vendidos, historial de eventos
- **Historial de eventos**: Muestra cronología de cierre automático, reaperturas, ventas de emergencia, cierre permanente
- **Filtros**: Por sucursal, fecha inicio, fecha fin
- **Paginación**: 20 resultados por página con navegación
- **Navegación**: Accesible desde sidebar bajo "Cierres de Caja"

---

### 🛡️ Corrección de Bugs Críticos

#### BUG-001: Rate Limiting en Login ✅
- **Archivo**: `src/modules/security/rate-limiter.ts`
- Implementado límite de 5 intentos fallidos por ventana de 15 minutos
- Clave compuesta `username:IP` para prevenir ataques distribuidos
- Respuesta HTTP 429 con header `Retry-After`
- Limpieza automática de intentos exitosos

#### BUG-002: Protección CSRF ✅
- **Archivo**: `middleware.ts`, `src/modules/security/csrf.ts`
- Validación de `Origin` header contra `Host` en middleware
- Verificación de `Content-Type: application/json` como indicador CSRF
- Soporte para header `x-csrf-token` y `x-requested-with`
- Generación y validación de tokens CSRF en base de datos con TTL de 12 horas
- Rutas de auth exentas de CSRF

#### BUG-003: Revocación de Tokens de Sesión ✅
- **Archivo**: `src/modules/security/token-revocation.ts`
- Hash SHA-256 de tokens almacenados en tabla `RevokedSession`
- Verificación en cada `getCurrentSession()` contra lista de revocación
- Revocación automática en logout (`POST /api/auth/logout`)
- **NUEVO**: Revocación automática al cambiar contraseña con limpieza de cookie

#### BUG-004: Contraseñas por Defecto y Forzar Cambio ✅
- **Archivo**: `prisma/seed.ts`
- Contraseñas únicas por rol: `Master#Init2026!`, `Super#Init2026!`, `Sales#Init2026!`, `Caja#Init2026!`, `Bodega#Init2026!`
- Campo `mustChangePassword` defaults a `true` en esquema Prisma
- Login redirige a `/app/change-password` si `mustChangePassword` es true
- **NUEVO**: Página de cambio de contraseña creada (`src/app/app/change-password/page.tsx`)

#### Cookie de Sesión Mejorada ✅
- **Archivo**: `src/modules/auth/service.ts`
- **NUEVO**: `maxAge` explícito en cookie de sesión (coincide con TTL del token)
- Atributos: `httpOnly`, `secure` (producción), `sameSite: strict`

---

### 🔧 Corrección de Bugs Altos

#### BUG-006: Race Conditions en Stock ✅
- **Archivo**: `src/modules/payments/service.ts`
- Re-verificación atómica de stock dentro de la transacción de pago
- Previene situación donde stock se agota entre submit y pago
- Error específico `INSUFFICIENT_STOCK_AT_PAYMENT` con detalles en auditoría

#### BUG-007: Cálculo de grandTotal ✅
- **Archivo**: `src/modules/sales/totals.ts`
- `lineSubtotal` ya incluye descuento aplicado (`qty * price - discount`)
- `grandTotal = subtotal + taxTotal` (correcto, descuentos ya aplicados en líneas)
- `discountTotal` se trackea por separado solo para reportes

#### BUG-010: Números de Orden Únicos ✅
- **Archivo**: `src/modules/sales/service.ts`
- Formato: `SO-{BRANCH}-{TIMESTAMP_BASE36}-{CRYPTO_RANDOM_8HEX}`
- Usa `crypto.randomBytes(4)` para evitar colisiones

---

### 📐 Cambios en Esquema Prisma

#### Nuevos Modelos
- `CashClosure` — Registro de cierre de caja por sucursal/día con totales, estado, reaperturas
- `CashClosureLog` — Historial de eventos (cierre, reapertura, venta de emergencia, cierre permanente)
- `LoginAttempt` — Rate limiting de intentos de login
- `RevokedSession` — Tokens de sesión revocados
- `CsrfToken` — Tokens CSRF almacenados en DB

#### Nuevos Enum Values
- `CashSessionStatus`: `AUTO_CLOSED`, `PERMANENTLY_CLOSED`

---

### 🔧 Corrección de Bug de Build
- **Archivo**: `src/components/pos/PosShellWrapper.tsx`
- Fix type error con `exitHref` y tipado estricto de `RouteImpl` de Next.js 15

---

### 📝 Archivos Creados/Modificados

#### Creados
- `src/modules/cash-closure/service.ts` — Servicio completo de cierre de caja
- `src/modules/cash-closure/scheduler.ts` — Scheduler de cierre automático
- `src/modules/security/rate-limiter.ts` — Rate limiting de login
- `src/modules/security/csrf.ts` — Generación/validación CSRF tokens
- `src/modules/security/token-revocation.ts` — Revocación de sesiones
- `src/app/api/cash-closure/route.ts` — API cierre manual
- `src/app/api/cash-closure/status/route.ts` — API estado de cierre
- `src/app/api/cash-closure/reopen/route.ts` — API reapertura
- `src/app/api/cash-closure/reports/route.ts` — API reportes de cierre
- `src/app/app/master/cash-closure-reports/page.tsx` — Dashboard reportes
- `src/app/app/change-password/page.tsx` — Página de cambio de contraseña obligatorio
- `CHANGELOG.md` — Este archivo

#### Modificados
- `prisma/schema.prisma` — Nuevos modelos y enums para cierre de caja y seguridad
- `prisma/seed.ts` — Contraseñas únicas por rol
- `middleware.ts` — Protección CSRF mejorada con múltiples capas
- `instrumentation.ts` — Inicio del scheduler de cierre
- `src/modules/auth/service.ts` — Cookie maxAge, import env
- `src/modules/sales/service.ts` — Verificación de cierre antes de crear órdenes
- `src/modules/sales/totals.ts` — Corrección de cálculo grandTotal
- `src/modules/payments/service.ts` — Verificación atómica de stock, tracking de ventas de emergencia
- `src/app/api/auth/login/route.ts` — Rate limiting integrado
- `src/app/api/auth/logout/route.ts` — Revocación de token
- `src/app/api/auth/change-password/route.ts` — Revocación de sesión al cambiar contraseña
- `src/components/navigation/app-sidebar.tsx` — Link a reportes de cierre
- `src/components/pos/PosShellWrapper.tsx` — Fix tipo exitHref
