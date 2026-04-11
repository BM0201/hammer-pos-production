# Módulo de Gastos Operativos y Precio Sugerido

## Descripción General

Este módulo permite al rol **MASTER** registrar gastos operativos mensuales por sucursal y calcular automáticamente el **precio de venta sugerido** de cualquier producto, considerando tanto el costo de compra como los gastos operativos prorrateados y un margen de utilidad deseado.

---

## Sistema de Costeo

Se utiliza **costeo por absorción simplificado**: todos los gastos operativos fijos mensuales se distribuyen uniformemente entre las unidades vendidas estimadas.

### Fórmula

```
1. Gasto por Unidad = Gastos Mensuales Totales ÷ Unidades Vendidas Estimadas
2. Costo Total = Costo de Compra + Gasto por Unidad
3. Precio Sugerido = Costo Total ÷ (1 − Margen de Utilidad)
```

### Ejemplo Práctico

**Escenario:** Sucursal MGA con los siguientes gastos mensuales:

| Categoría | Descripción | Monto (C$) |
|-----------|-------------|------------|
| Personal  | Salarios administrativos | 15,000 |
| Personal  | Vendedores | 10,000 |
| Servicios | Agua | 1,500 |
| Servicios | Luz eléctrica | 3,000 |
| Servicios | Internet | 1,200 |
| Renta     | Local comercial | 12,000 |
| Alimentación | Comidas del personal | 4,000 |
| Mantenimiento | General | 2,000 |
| Transporte | Entregas | 1,300 |
| **Total** | | **C$50,000** |

**Configuración de precios:**
- Unidades estimadas vendidas por mes: **1,000**
- Margen de utilidad deseado: **7%**

**Cálculo para bolsa de cemento (Costo de compra: C$400):**

```
Gasto por unidad = C$50,000 ÷ 1,000 = C$50.00
Costo total = C$400 + C$50 = C$450.00
Precio sugerido = C$450 ÷ (1 − 0.07) = C$483.87
Ganancia por unidad = C$483.87 − C$450 = C$33.87
```

**Otro ejemplo con margen de 30%:**

```
Costo total = C$400 + C$50 = C$450.00
Precio sugerido = C$450 ÷ (1 − 0.30) = C$642.86
Ganancia por unidad = C$642.86 − C$450 = C$192.86
```

---

## Categorías de Gastos

| Código | Etiqueta | Descripción |
|--------|----------|-------------|
| PAYROLL | Personal / Nómina | Salarios, prestaciones |
| UTILITIES | Servicios | Agua, luz, internet, teléfono |
| RENT | Renta / Alquiler | Alquiler del local |
| FOOD | Alimentación | Comidas del personal |
| MAINTENANCE | Mantenimiento | Reparaciones, limpieza |
| TRANSPORT | Transporte | Entregas, gasolina |
| MARKETING | Publicidad / Marketing | Publicidad, redes sociales |
| OTHER | Otros | Gastos varios |

---

## Métodos de Prorrateo

| Método | Descripción |
|--------|-------------|
| BY_QUANTITY | Los gastos se dividen entre el número total de unidades vendidas estimadas |
| BY_VALUE | Los gastos se prorratean proporcionalmente al valor de cada producto |

---

## Modelo de Datos

### OperatingExpense
Registra gastos operativos mensuales por sucursal:
- `branchId`: Sucursal
- `category`: Categoría del gasto (enum)
- `description`: Descripción libre
- `amount`: Monto mensual en C$
- `isActive`: Soft-delete flag
- `effectiveFrom/To`: Vigencia del gasto

### PricingConfig
Configuración de precios por sucursal (1:1):
- `branchId`: Sucursal (unique)
- `desiredMarginPercent`: Margen deseado (%)
- `prorationMethod`: Método de prorrateo
- `estimatedMonthlyUnits`: Unidades estimadas vendidas por mes

### ProductPricing
Historial de precios calculados:
- `productId`, `branchId`: Producto y sucursal
- `purchaseCost`: Costo de compra
- `operatingExpensePerUnit`: Gasto prorrateado
- `totalCostPerUnit`: Costo total
- `marginPercent`: Margen utilizado
- `suggestedPrice`: Precio sugerido calculado
- `appliedPrice`: Precio realmente aplicado (override manual)

---

## API Endpoints

| Método | Ruta | Descripción | Rol |
|--------|------|-------------|-----|
| GET | `/api/expenses?branchId=xxx` | Listar gastos por sucursal | MASTER |
| GET | `/api/expenses?branchId=xxx&summary=true` | Resumen por categoría | MASTER |
| POST | `/api/expenses` | Crear gasto operativo | MASTER |
| PUT | `/api/expenses/[id]` | Actualizar gasto | MASTER |
| DELETE | `/api/expenses/[id]` | Desactivar gasto (soft delete) | MASTER |
| GET | `/api/pricing/config?branchId=xxx` | Obtener configuración | MASTER |
| POST | `/api/pricing/config` | Crear/actualizar configuración | MASTER |
| GET | `/api/pricing/suggested?branchId=xxx&purchaseCostPerUnit=400` | Calcular precio sugerido | MASTER |

---

## Integración con Inventario

Cada vez que se registra un **PURCHASE_IN** (entrada de inventario por compra), el sistema automáticamente:

1. Calcula el precio sugerido usando la configuración de la sucursal
2. Guarda el cálculo en el historial (`ProductPricing`)
3. Retorna el precio sugerido en la respuesta del API

Esto permite que el operador vea inmediatamente cuánto debería costar el producto.

---

## Navegación

- Accesible desde: **Gobernanza → Gastos & Precios** (solo MASTER)
- Ruta: `/app/master/expenses`

---

## Guía de Uso

### 1. Configurar Gastos Operativos
1. Ir a **Gastos & Precios**
2. Seleccionar sucursal
3. En la pestaña "Gastos Operativos", agregar cada gasto mensual
4. Seleccionar categoría, escribir descripción y monto

### 2. Configurar Precios
1. Ir a la pestaña "Configuración de Precios"
2. Definir margen de utilidad deseado (ej: 30%)
3. Definir unidades mensuales estimadas
4. Guardar configuración

### 3. Calcular Precio Sugerido
1. Ir a la pestaña "Calculadora de Precio"
2. Ingresar el costo de compra del producto
3. El sistema calcula automáticamente el precio sugerido
4. Ver desglose: Costo + Gastos + Margen = Precio

### 4. Automático al Recibir Productos
- Al hacer un PURCHASE_IN, el precio sugerido se calcula automáticamente
- El resultado se guarda en el historial de precios del producto
