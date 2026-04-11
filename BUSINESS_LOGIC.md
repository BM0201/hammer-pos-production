# H.A.M.M.E.R. — Lógica de Negocio y Estructura Organizacional

> Documento vivo que define roles, permisos, flujos de trabajo, reglas de negocio y mejores prácticas del sistema POS/ERP multi-sucursal.

---

## 1. Contexto del Sistema

### 1.1 Visión General

**H.A.M.M.E.R.** es un sistema POS/ERP diseñado originalmente para **ferreterías**, pero con una arquitectura lo suficientemente flexible para adaptarse a cualquier tipo de comercio multi-sucursal (tiendas de materiales de construcción, distribuidoras, abarroterías, etc.).

### 1.2 Caso de Uso Actual

| Aspecto | Detalle |
|---------|---------|
| **Giro de negocio** | Ferretería con módulo especializado de madera |
| **Sucursales** | 3 — Managua (central), Masaya, Rivas |
| **Moneda** | Córdobas nicaragüenses (C$) |
| **Modelo de distribución** | Centralizado desde Managua hacia sucursales |
| **Versión actual** | v3.0 — Timber Improvements |

### 1.3 Principios de Diseño

1. **Centralización de control**: Precios, catálogo y configuraciones se gestionan desde Master.
2. **Descentralización operativa**: Cada sucursal opera de forma autónoma en ventas y caja.
3. **Flexibilidad por sucursal**: Roles habilitables/deshabilitables según necesidad.
4. **Trazabilidad total**: Toda acción queda en bitácora con usuario, fecha y detalle.
5. **Escalabilidad**: De 1 persona → equipo completo sin cambiar la estructura.

---

## 2. Estructura Organizacional

### 2.1 Sucursales

| Código | Nombre | Tipo | Notas |
|--------|--------|------|-------|
| MGA | Managua | **Sucursal Central** | Operaciones principales, sede del Master |
| MSY | Masaya | Sucursal | Recibe envíos desde Managua |
| RIV | Rivas | Sucursal | Recibe envíos desde Managua |

### 2.2 Importante

- **MASTER NO es una sucursal** — es un **ROL ADMINISTRATIVO GLOBAL**.
- Managua (MGA) es la sucursal central desde donde opera el usuario Master.
- Master puede crear envíos de productos hacia Masaya y Rivas.

---

## 3. Roles y Permisos

### 3.1 MASTER (Administrador Global)

**Acceso:** Global — todas las sucursales.

| Permiso | Descripción |
|---------|-------------|
| ✅ Crear productos | Único rol que puede crear/editar productos del catálogo |
| ✅ Editar precios | Único rol que puede modificar precios de venta |
| ✅ Gestión de usuarios | Crear, desactivar, asignar membresías |
| ✅ Inventario global | Ver inventario de TODAS las sucursales |
| ✅ Auditoría global | Acceso completo a bitácora |
| ✅ Envíos entre sucursales | Crear transferencias MGA → MSY/RIV |
| ✅ Aprobaciones | Aprobar solicitudes de override, descuentos, etc. |
| ✅ Reportes & Analytics | ABC-XYZ, KPIs, reportes financieros |
| ✅ Madera | Módulo completo de cubicación, viajes, precios |
| ✅ Categorías | Crear/editar categorías de productos |
| ✅ Gastos & Precios | Gestión de costos y márgenes |
| ✅ Personal & Nómina | Gestión de empleados |
| ✅ Pedidos de compra | Ingresar compras que van directo a inventario MGA |
| ✅ Configurar descuentos rotativos | Habilitar ABC-XYZ por producto |

**Dashboard:** Centro de Comando — Solo datos (ventas globales, KPIs por sucursal, alertas, tabla de rendimiento).

### 3.2 BRANCH_ADMIN (Admin Sucursal / Supervisor)

**Acceso:** Su sucursal asignada únicamente.

| Permiso | Descripción |
|---------|-------------|
| ✅ Vender (Punto de Venta) | **El supervisor VENDE** — abre directamente en PdV |
| ✅ Aceptar envíos | Recibe transferencias desde Master/MGA |
| ✅ Inventario local | Ver inventario de SU sucursal |
| ✅ Cobrar (si habilitado) | Puede actuar como cajero en sucursales pequeñas |
| ✅ Aprobaciones locales | Aprobar descuentos, overrides de su sucursal |
| ✅ Bitácora local | Ver auditoría de su sucursal |
| ✅ Reportes locales | Reportes de su sucursal |
| ❌ Crear productos | **NO PUEDE** crear ni editar productos |
| ❌ Editar precios | **NO PUEDE** cambiar precios |
| ❌ Dar descuentos | **NO PUEDE** aplicar descuentos (excepto ABC-XYZ habilitados por Master) |
| ❌ Gestión global | No accede a otras sucursales |

**Dashboard:** Supervisión de Sucursal — Solo datos (ventas del día, cobros pendientes, despachos, inventario crítico).

### 3.3 SALES (Facturador/Vendedor)

**Acceso:** Su sucursal asignada.

| Permiso | Descripción |
|---------|-------------|
| ✅ Crear órdenes | Punto de venta — crear tickets/facturas |
| ✅ Ver catálogo | Consultar productos y precios |
| ✅ Enviar a cobro | Enviar orden al cajero para cobro |
| ❌ Cobrar | No puede cobrar directamente |
| ❌ Inventario | No modifica inventario |
| ❌ Precios | No edita precios |
| ❌ Descuentos | No puede dar descuentos |

**Dashboard:** Punto de Venta — Solo datos (borradores abiertos, enviadas a cobro, ventas del día).

### 3.4 CASHIER (Cajero)

**Acceso:** Su sucursal asignada. **DEBE SER HABILITADO** (no viene activo por defecto).

| Permiso | Descripción |
|---------|-------------|
| ✅ Cobrar órdenes | Procesar pagos de órdenes enviadas |
| ✅ Abrir/cerrar caja | Sesiones de caja |
| ✅ Solicitar cierre | Solicitar cierre de sesión |
| ❌ Crear órdenes | No puede crear tickets |
| ❌ Modificar tickets | **No puede cambiar ni modificar tickets** |
| ❌ Inventario | No accede a inventario |
| ❌ Precios | No edita precios |
| ❌ Descuentos | No puede dar descuentos |

**Dashboard:** Caja & Cobros — Solo datos (sesiones activas, órdenes por cobrar, último cobro, discrepancias).

**Nota sobre Caja Compartida:** La caja física puede ser compartida entre múltiples cajeros/turnos. Cada sesión de caja se identifica por usuario, permitiendo responsabilidad individual aunque compartan el punto físico.

### 3.5 WAREHOUSE (Bodega)

**Acceso:** Su sucursal asignada.

| Permiso | Descripción |
|---------|-------------|
| ✅ Despacho | Procesar entregas de productos |
| ✅ Recibir envíos | Aceptar transferencias |
| ✅ Inventario | Consulta de inventario local |
| ❌ Ventas | No vende |
| ❌ Cobros | No cobra |

**Dashboard:** Bodega & Despacho — Solo datos (pendientes de despacho, despachos hoy, excepciones).

---

## 4. Modelos Operativos por Sucursal

### 4.1 Managua (MGA) — Modelo de 3 Pasos

Sucursal grande con personal especializado y separación de funciones:

```
PASO 1: Facturador → Crea ticket y envía a cobro
PASO 2: Cajero    → Cobra al cliente (caja compartida, múltiples usuarios)
PASO 3: Bodega    → Despacha productos

Roles activos: Facturador(es) + Cajero(s) + Bodeguero(s) + Supervisor
```

**Ventajas:**
- Mayor control y separación de funciones
- Facilita auditoría (quien vende ≠ quien cobra ≠ quien despacha)
- Ideal para alto volumen de transacciones
- Caja compartida permite turnos rotativos

### 4.2 Masaya (MSY) / Rivas (RIV) — Modelo de 2 Pasos

Sucursales pequeñas con operación ágil:

```
PASO 1: Super Cajero → Factura + Cobra + Imprime (un solo flujo)
PASO 2: Despacho     → Entrega de productos

Roles activos: Supervisor (con permiso de caja) + posible Bodeguero
```

**Ventajas:**
- Operación más ágil con menos personal
- El supervisor tiene control total de la operación
- Menor costo operativo
- Se puede escalar a 3 pasos si la sucursal crece

### 4.3 Escalabilidad del Modelo

```
Sucursal nueva → Inicia con 1 persona (Super Cajero)
              → Crece: se habilita Cajero separado
              → Crece más: se agrega Bodeguero
              → Sucursal grande: todos los roles activos
              
El sistema se adapta SIN cambiar la estructura base.
```

---

## 5. Flujo de Compra e Inventario

### 5.1 Flujo de Compra (Pedido de Compra)

```
Master → Ingresa PEDIDO DE COMPRA
       → Productos caen automáticamente en inventario de Managua (MGA)
       → Stock de MGA se actualiza inmediatamente
```

### 5.2 Flujo de Envío a Sucursales

```
Master (MGA) → Crea ENVÍO a sucursal destino (MSY/RIV)
             → Selecciona productos y cantidades
             → FIJA PRECIO DE VENTA NUEVO (con opción de actualizar catálogo completo)
             → Inventario MGA se reduce
             
Supervisor destino → Recibe notificación de envío
                   → Acepta el envío
                   → Inventario de la sucursal destino se actualiza
```

### 5.3 Control de Precios en Envío

Al crear un envío, Master tiene la opción de:
1. **Mantener precios actuales** — Los productos se envían con los precios vigentes.
2. **Actualizar precio de venta** — Se fija un nuevo precio que se refleja en el catálogo.
3. **Actualización masiva** — Opción de actualizar el catálogo completo de la sucursal destino.

**Regla de oro:** Solo Master puede modificar precios. Ni Supervisor, ni Cajero, ni Vendedor pueden alterar precios, modificar tickets ya creados, ni otorgar descuentos (salvo los descuentos rotativos ABC-XYZ previamente configurados por Master).

### 5.4 Separación por Sucursal

- Cada sucursal tiene su **propio inventario**.
- **NO se combinan** inventarios entre sucursales.
- Master puede **auditar** inventario de cualquier sucursal individualmente o ver un consolidado.

### 5.5 Movimientos de Inventario

| Tipo | Origen | Destino | Autorización |
|------|--------|---------|--------------|
| Compra (Pedido) | Proveedor | MGA | Master ingresa |
| Venta | Sucursal | Cliente | Automático al cobrar |
| Envío | MGA | MSY/RIV | Master crea, Supervisor acepta |
| Ajuste | Sucursal | — | Supervisor + Master aprueba |
| Devolución | Cliente | Sucursal | Supervisor autoriza |

### 5.6 Inventario Crítico

- Productos con **≤ 5 unidades** se marcan como inventario crítico.
- Aparece como alerta en los dashboards.
- Master recibe alertas de todas las sucursales.

---

## 6. Control de Precios y Descuentos

### 6.1 Actualización Centralizada de Precios

- **Solo Master** puede crear, editar y fijar precios de venta.
- Los precios se actualizan desde el Panel Master y se sincronizan a todas las sucursales.
- Los cambios de precio quedan registrados en bitácora con fecha, usuario y valores anterior/nuevo.

### 6.2 Sincronización en Tiempo Real

- Cuando Master actualiza un precio, el cambio se refleja inmediatamente en:
  - Catálogo de productos de todas las sucursales
  - Punto de Venta (nuevos tickets usan precio actualizado)
  - Calculadora de Madera (si aplica)
- Tickets ya creados **conservan** el precio al momento de su creación.

### 6.3 Restricciones por Rol

| Acción | Master | Supervisor | Cajero | Vendedor |
|--------|--------|------------|--------|----------|
| Fijar precio de venta | ✅ | ❌ | ❌ | ❌ |
| Modificar ticket existente | ✅ | ❌ | ❌ | ❌ |
| Aplicar descuento manual | ✅ | ❌ | ❌ | ❌ |
| Descuento rotativo (ABC-XYZ) | Configura | Aplica automático | N/A | N/A |
| Cambiar precio en PdV | ❌ | ❌ | ❌ | ❌ |

### 6.4 Gestión de Promociones

- Las promociones y descuentos se configuran exclusivamente desde Master.
- Se implementan a través del sistema de **descuento rotativo ABC-XYZ**.
- Los descuentos se aplican automáticamente según la clasificación del producto.

---

## 7. Análisis ABC-XYZ y Descuento Rotativo

### 7.1 ¿Qué es el Análisis ABC-XYZ?

Es una metodología combinada de clasificación de inventario que cruza dos dimensiones:

**Clasificación ABC (por valor/rotación de ventas):**

| Clase | Descripción | % Inventario típico | % Ventas típico |
|-------|-------------|---------------------|-----------------|
| **A** | Alta rotación / Alto valor | ~20% de SKUs | ~80% de ventas |
| **B** | Media rotación / Valor medio | ~30% de SKUs | ~15% de ventas |
| **C** | Baja rotación / Bajo valor | ~50% de SKUs | ~5% de ventas |

**Clasificación XYZ (por estabilidad de demanda):**

| Clase | Descripción | Coeficiente de Variación |
|-------|-------------|--------------------------|
| **X** | Demanda estable y predecible | CV < 0.5 |
| **Y** | Demanda fluctuante con tendencia | 0.5 ≤ CV < 1.0 |
| **Z** | Demanda errática e impredecible | CV ≥ 1.0 |

### 7.2 Matriz ABC-XYZ

```
       X (Estable)      Y (Fluctuante)    Z (Errática)
A  │ AX: Estrella      │ AY: Alta valor  │ AZ: Alta valor    │
   │ Alto valor,       │ pero fluctúa    │ pero impredecible │
   │ demanda estable   │                 │                   │
───┼───────────────────┼─────────────────┼───────────────────┤
B  │ BX: Estable,      │ BY: Medio       │ BZ: Medio valor,  │
   │ valor medio       │ en todo         │ demanda errática  │
───┼───────────────────┼─────────────────┼───────────────────┤
C  │ CX: Bajo valor,   │ CY: Bajo valor, │ CZ: Candidato    │
   │ pero estable      │ fluctuante      │ a descontinuar    │
```

### 7.3 Estrategia de Descuentos Rotativos

El sistema utiliza la clasificación ABC-XYZ para aplicar descuentos inteligentes:

| Categoría | Estrategia de Descuento | Justificación |
|-----------|------------------------|---------------|
| **AX** | Descuentos mínimos o por volumen | Ya se venden bien, no necesitan estímulo |
| **AY** | Descuentos en valles de demanda | Suavizar fluctuaciones |
| **AZ** | Descuentos puntuales para mover stock | Evitar sobrestock en picos impredecibles |
| **BX/BY** | Descuentos rotativos periódicos | Estimular paso a categoría A |
| **BZ** | Descuentos agresivos temporales | Reducir riesgo de inventario muerto |
| **CX** | Ofertas de paquete | Mover volumen empaquetando con productos A |
| **CY/CZ** | Liquidación o descontinuación | Liberar capital y espacio de almacén |

### 7.4 Implementación en H.A.M.M.E.R.

1. **Master configura** qué productos tienen descuento rotativo habilitado.
2. El sistema **clasifica automáticamente** productos según ventas históricas.
3. Los descuentos se **aplican automáticamente** en Punto de Venta cuando corresponde.
4. **Ni Supervisor ni Cajero** pueden modificar estos descuentos — solo Master los habilita/configura.
5. Los reportes muestran el impacto de los descuentos en ventas y márgenes.

---

## 8. Flujos de Trabajo

### 8.1 Flujo de Venta (Managua — 3 pasos)

```
Facturador → Crea orden (DRAFT)
           → Agrega productos al ticket
           → Envía a cobro (SENT_TO_PAYMENT)
           
Cajero     → Recibe orden en cola
           → Cobra al cliente (PAID)
           → Se actualiza inventario automáticamente
           
Bodega     → Recibe despacho pendiente
           → Entrega productos (DISPATCHED)
```

### 8.2 Flujo de Venta (Masaya/Rivas — 2 pasos)

```
Super Cajero → Crea orden + Cobra en un solo flujo
             → Inventario se actualiza automáticamente
             
Despacho     → Entrega productos (DISPATCHED)
```

### 8.3 Flujo de Caja

```
Cajero → Abre sesión de caja (con monto de apertura)
       → Cobra órdenes durante el día
       → Solicita cierre de sesión
       → Sistema calcula discrepancias
       → Supervisor aprueba cierre (si hay discrepancia)
```

**Caja Compartida:**
- Múltiples cajeros pueden compartir la misma caja física.
- Cada sesión se identifica por usuario individual.
- El sistema rastrea responsabilidad por usuario, no por caja física.
- Esto permite turnos rotativos y escalabilidad futura.

### 8.4 Flujo del Admin Sucursal (Supervisor)

```
Supervisor → Abre sesión → Va directo a Punto de Venta
           → Vende como facturador
           → Acepta envíos desde Master
           → Aprueba descuentos/overrides
           → Revisa reportes de su sucursal
```

---

## 9. Seguridad del Sistema

### 9.1 Principios Fundamentales

1. **Mínimo privilegio**: Cada rol solo accede a lo que necesita.
2. **Separación de funciones**: Quien vende no cobra, quien cobra no ajusta inventario.
3. **Trazabilidad**: Toda acción queda en bitácora con usuario, fecha y detalle.
4. **Aprobaciones**: Operaciones sensibles requieren autorización de nivel superior.

### 9.2 Control de Acceso por Roles

- Autenticación por usuario y contraseña.
- Roles asignados por membresía (usuario → sucursal + rol).
- Las sesiones expiran automáticamente tras inactividad.
- Los accesos se registran en bitácora.

### 9.3 Autenticación y Protección

| Medida | Estado | Detalle |
|--------|--------|---------|
| Contraseñas encriptadas (bcrypt) | ✅ Implementado | Hash con salt |
| Sesiones con token JWT | ✅ Implementado | Expiración configurable |
| Protección de rutas por rol | ✅ Implementado | Middleware de autorización |
| Autenticación multi-factor (2FA) | 🔜 Planificado | Para MASTER y SYSTEM_ADMIN |
| Bloqueo por intentos fallidos | 🔜 Planificado | Máximo 5 intentos |

### 9.4 Auditoría de Transacciones

- **Toda operación sensible** se registra en la bitácora:
  - Creación/modificación de productos y precios
  - Ventas, cobros, despachos
  - Ajustes de inventario
  - Cambios de usuario y permisos
  - Inicio/cierre de sesiones de caja
- Los registros incluyen: **usuario, fecha/hora, acción, valores anteriores y nuevos, IP**.
- La bitácora es **inmutable** — no se puede editar ni eliminar.
- Master tiene acceso a bitácora global; Supervisores solo a su sucursal.

### 9.5 Prevención de Fraude

| Riesgo | Mitigación |
|--------|-----------|
| Alteración de precios | Solo Master puede modificar precios |
| Descuentos no autorizados | Descuentos solo vía ABC-XYZ configurado por Master |
| Modificación de tickets | Cajero/Vendedor NO pueden modificar tickets |
| Robo de caja | Sesiones individuales con monto de apertura/cierre |
| Discrepancias de caja | Sistema calcula diferencias y requiere aprobación |
| Desvío de inventario | Movimientos requieren autorización multinivel |

### 9.6 Operaciones Sensibles (Solo Master)

- Crear/editar/desactivar productos
- Modificar precios de venta
- Crear/desactivar usuarios
- Ajustes de inventario globales
- Configuración del sistema
- Habilitar descuentos rotativos

### 9.7 Backups y Continuidad

| Elemento | Recomendación |
|----------|--------------|
| Base de datos | Backups automáticos diarios con retención de 30 días |
| Configuraciones | Versionadas en repositorio |
| Datos de transacciones | Respaldo en tiempo real (replicación) |
| Plan de recuperación | RPO < 1 hora, RTO < 4 horas |

### 9.8 Roles de Sistema Futuros

```
🔒 SYSTEM_ADMIN (Programador del Sistema)
   - Configuraciones técnicas del sistema
   - Acceso a logs de sistema
   - Gestión de backups
   - Configuración de integraciones
   - Métodos SUPER seguros para evitar saltos de permisos
   
   IMPORTANTE: Este rol NO debe ser accesible desde la interfaz normal.
   Debe requerir autenticación de doble factor y estar aislado.
```

---

## 10. Flexibilidad y Escalabilidad

### 10.1 Habilitar/Deshabilitar Roles

```
El sistema DEBE ser flexible para:
  ✅ Habilitar/deshabilitar el rol de Cajero por sucursal
  ✅ Asignar múltiples roles a un mismo usuario
  ✅ El supervisor puede tener permisos de cajero si es necesario
  ✅ Escalar de 1 persona → equipo completo sin cambiar la estructura
```

### 10.2 Adaptación a Diferentes Modelos de Negocio

H.A.M.M.E.R. puede adaptarse a distintos giros comerciales:

| Giro | Adaptación |
|------|-----------|
| **Ferretería** | Módulo de madera, ventas por medida, catálogo técnico |
| **Distribuidora** | Envíos masivos, control de rutas, precios por volumen |
| **Abarrotería** | Ventas por peso/medida, código de barras, caducidad |
| **Tienda de materiales** | Catálogo técnico, fichas de producto, medidas especiales |
| **Comercio general** | Catálogo estándar, PdV rápido, control de caja |

### 10.3 Configuración por Sucursal

Cada sucursal puede configurarse independientemente:

- **Roles activos** — Qué roles están habilitados (ej: sin cajero en sucursales pequeñas).
- **Modelo operativo** — 2 pasos o 3 pasos según tamaño.
- **Cajas físicas** — Cantidad de cajas y configuración compartida.
- **Usuarios asignados** — Membresías específicas por sucursal.

### 10.4 Rol de "Programador del Sistema"

Para configuraciones sensibles que no deben estar al alcance del Master regular:

- Umbrales de inventario crítico
- Parámetros de clasificación ABC-XYZ
- Configuración de backups y retención
- Integraciones con sistemas externos
- Configuración de impresoras y hardware
- Variables de entorno y conexiones

---

## 11. Mejores Prácticas para Ferreterías

### 11.1 Gestión de Inventario Multi-Sucursal

| Práctica | Detalle |
|----------|---------|
| **Inventario centralizado** | Master controla abastecimiento desde Managua |
| **Reabastecimiento basado en datos** | Usar reportes ABC-XYZ para priorizar reórdenes |
| **Stock de seguridad** | Mantener stock mínimo diferenciado por categoría ABC |
| **Conteos cíclicos** | Auditorías parciales semanales (productos A), mensuales (B), trimestrales (C) |
| **Transferencias eficientes** | Envíos programados para minimizar faltantes |
| **Alertas de inventario crítico** | Notificaciones automáticas cuando stock ≤ umbral |

### 11.2 Ventas por Peso/Medida

Las ferreterías manejan productos vendidos por:
- **Peso**: Clavos, tornillos a granel, alambre por kilo.
- **Medida lineal**: Tubos, varillas, mangueras por metro/pie.
- **Volumen**: Pintura por galón/cuarto, cemento por bolsa.
- **Cubicación**: Madera por pies tablares (módulo especializado en H.A.M.M.E.R.).

**Recomendación:** Configurar unidades de medida flexibles por producto (UN, KG, MT, LT, PT).

### 11.3 Facturación Electrónica

| Aspecto | Recomendación |
|---------|--------------|
| **Formato** | Cumplir con normativa DGI de Nicaragua |
| **Numeración** | Secuencial por sucursal (SO-MGA-xxx, SO-MSY-xxx) |
| **Archivo** | Retención digital por 10 años |
| **Impresión** | Tickets POS + factura formal según requerimiento |

### 11.4 Control de Crédito a Clientes

| Aspecto | Recomendación |
|---------|--------------|
| **Límite de crédito** | Definir por cliente según historial |
| **Plazo de pago** | Configurar días de crédito (15, 30, 60 días) |
| **Corte de crédito** | Bloqueo automático si excede límite o mora |
| **Reporte de cartera** | Antigüedad de saldos por sucursal |
| **Aprobación** | Créditos nuevos aprobados por Supervisor/Master |

### 11.5 Gestión de Proveedores

| Aspecto | Recomendación |
|---------|--------------|
| **Registro** | Base de datos de proveedores con contacto y condiciones |
| **Evaluación** | Calificación por cumplimiento, precio, calidad |
| **Comparación** | Cotizaciones múltiples para compras mayores |
| **Historial** | Registro de compras y condiciones por proveedor |
| **Pagos** | Control de cuentas por pagar y vencimientos |

---

## 12. Módulo de Madera

### 12.1 Permisos

- **Solo MASTER** tiene acceso completo al módulo de madera.
- Calculadora de cubicación, precios por pulgada, viajes.
- Gestión de precios de madera (costo/pie, precio por pulgada).

### 12.2 Flujo

```
Master → Calculadora de Madera (cubicación en tiempo real)
       → Gestión de Precios (margen, costo)
       → Crear Viaje de Madera
         → Seleccionar destino (sucursal)
         → Agregar medidas y cantidades
         → Registrar costo del viaje
         → Enviar a inventario de sucursal destino
```

### 12.3 Cubicación

- **Grosor** (pulgadas) × **Ancho** (pulgadas) × **Largo** (pies) = Pies tablares
- Fórmula: `(grosor × ancho × largo) / 12 = pies tablares`
- Clasificación: TABLA, TABLILLA, CUADRO según dimensiones.

---

## 13. Personal y Roles (Módulo Usuarios)

### ¿Qué va en "Usuarios & Roles"?
1. **Crear usuario**: username, nombre completo, correo, contraseña inicial
2. **Asignar membresía**: usuario → sucursal + rol
3. **Gestionar estado**: activar/desactivar usuarios
4. **Resetear contraseña**: generar nueva contraseña temporal
5. **Rol global**: MASTER (único que tiene rol global)

### ¿Qué va en "Personal & Nómina"?
1. **Datos de empleados**: información personal, contacto
2. **Historial**: membresías asignadas, cambios de rol
3. **Nómina**: (futuro) control de pagos y deducciones

---

## 14. Plan de Implementación

### Fase Actual (v3.0)
- [x] Sistema de roles básico (5 roles)
- [x] Dashboards por rol (solo datos, sin navegación)
- [x] Módulo de madera completo
- [x] Punto de venta básico
- [x] Sistema de caja (con caja compartida)
- [x] Inventario por sucursal
- [x] Modelo operativo flexible (2 y 3 pasos)
- [x] Control centralizado de precios
- [x] Bitácora de auditoría

### Próximas Fases
- [ ] Análisis ABC-XYZ automatizado con descuentos rotativos
- [ ] Permisos granulares por sucursal (habilitar/deshabilitar roles)
- [ ] Rol SYSTEM_ADMIN separado
- [ ] Autenticación multi-factor (2FA)
- [ ] Reportes avanzados (gráficos, tendencias)
- [ ] Productos más vendidos en dashboard
- [ ] Gráficos de ventas por período
- [ ] Inventario crítico con alertas por correo
- [ ] Sistema de notificaciones en tiempo real
- [ ] Módulo de devoluciones
- [ ] Integración con impresoras de tickets
- [ ] Facturación electrónica DGI
- [ ] Control de crédito a clientes
- [ ] Gestión de proveedores
- [ ] Bloqueo por intentos fallidos de login
- [ ] Backups automáticos programados

---

*Última actualización: 4 de abril, 2026*
*Versión: 3.0 - Timber Improvements*
