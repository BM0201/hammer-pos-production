# 🧠 AI Insights Module

## Descripción

Módulo de análisis inteligente para H.A.M.M.E.R. POS ADMIN que genera insights accionables a partir de datos históricos de ventas, inventario y operaciones. **No es un chatbot** — es un panel de sugerencias automatizadas que detecta patrones que el ojo humano no captaría.

## Arquitectura

```
src/modules/ai-insights/
├── analyzer.ts            # Utilidades estadísticas y tipos compartidos
├── discount-optimizer.ts  # Motor de sugerencias de descuentos
├── anomaly-detector.ts    # Detección de anomalías (Z-Score, IQR)
├── discrepancy-detector.ts# Detección de discrepancias en datos
├── pattern-analyzer.ts    # Análisis de patrones y recomendaciones
├── service.ts             # Orquestador con caché en memoria
└── README.md              # Esta documentación
```

## Algoritmos Utilizados

### 1. Detección de Anomalías
- **Z-Score**: Identifica valores que se desvían N desviaciones estándar de la media
  - `|z| > 2.5` → Severidad alta
  - `|z| > 2.0` → Severidad media
  - `|z| > 1.5` → Severidad baja
- **IQR (Interquartile Range)**: Método robusto contra outliers
  - Outlier si valor < Q1 - 1.5×IQR o > Q3 + 1.5×IQR
  - Menos sensible a distribuciones no normales que Z-Score

### 2. Análisis de Tendencias
- **Regresión Lineal Simple**: Calcula pendiente (slope) de ventas diarias
  - Pendiente positiva → demanda creciente
  - Pendiente negativa → demanda decreciente
  - **R²** mide la calidad del ajuste (> 0.3 = tendencia significativa)
- **Coeficiente de Variación (CV)**: Estabilidad de demanda
  - CV < 0.5 → demanda estable (X)
  - 0.5 ≤ CV < 1.0 → variable (Y)
  - CV ≥ 1.0 → irregular (Z)

### 3. Market Basket Analysis
- **Co-ocurrencia**: Cuenta pares de productos en la misma orden
- **Soporte**: % de órdenes que contienen el par (mínimo 5%)
- **Confianza**: P(B|A) — probabilidad de comprar B dado que compraron A
- **Lift**: Factor multiplicador vs. independencia estadística
  - Lift > 1.5 → asociación significativa

### 4. Clasificación de Productos
- Aprovecha la **clasificación ABC-XYZ** existente en el sistema
- ABC = contribución al valor de ventas (A: 70-80%, B: 15-25%, C: 5-10%)
- XYZ = variabilidad de demanda
- Combina con índice de rotación y días en stock

## Tipos de Insights

### 🎯 Sugerencias de Descuentos
| Tipo | Criterio | Descuento Sugerido |
|------|----------|-------------------|
| Baja rotación | Rotación < 0.3 + stock disponible | Proporcional al gap de rotación |
| Alto margen | Margen > 40% + no es clase A | 40% del margen excedente |
| Inventario estancado | > 60 días sin reposición | Urgencia proporcional a días |
| Patrón temporal | Ventas 2x en ciertos días | 10% en días débiles |

### ⚠️ Discrepancias
- **Descuentos inusuales**: Órdenes con descuento > 30% o > 2.5σ del promedio
- **Transacciones duplicadas**: Mismo monto, misma sucursal, < 5 minutos
- **Inconsistencias de precio**: Venta > 10% sobre lista o > 40% bajo lista
- **Devoluciones anómalas**: Tasa > 10% o usuarios con muchas devoluciones
- **Desviaciones de sucursal**: Sucursales con ventas < 1.5σ del promedio de red

### 🔍 Anomalías
- **Ventas por hora**: Franjas horarias con ventas > 2σ del promedio
- **Transacciones grandes**: Montos > 1.5× IQR superior + 3σ
- **Precios anómalos**: Productos vendidos a precios > 2.5σ del promedio
- **Inventario**: Stock negativo/cero con movimientos recientes
- **Cajeros**: Ticket promedio o descuentos > 2σ de los pares

### 📊 Patrones
- **Market Basket**: Pares de productos con soporte > 5% y lift > 1.5
- **Temporal**: Días fuertes vs débiles, horas pico
- **Tendencia de demanda**: Productos con pendiente significativa (R² > 0.3)
- **Eficiencia de vendedores**: Ranking por facturación total

### 💡 Recomendaciones
- Tendencia general de ventas (creciente/decreciente)
- Productos clase A con stock crítico
- Tasa de descuentos vs facturación total

## API Endpoints

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/ai-insights/discount-suggestions` | GET | Sugerencias de descuentos |
| `/api/ai-insights/anomalies` | GET | Anomalías detectadas |
| `/api/ai-insights/discrepancies` | GET | Discrepancias encontradas |
| `/api/ai-insights/patterns` | GET | Patrones y recomendaciones |
| `/api/ai-insights/refresh` | POST | Recalcular todos los insights |

### Parámetros comunes (query string)
- `branchId` (opcional): Filtrar por sucursal
- `days` (opcional): Período de análisis (default: 30 para descuentos/patrones, 7 para anomalías/discrepancias)

## Caché

Los resultados se cachean en memoria por 15 minutos con la siguiente lógica:
- Invalidación automática si cambian `branchId` o `days`
- Invalidación manual vía endpoint `/api/ai-insights/refresh`
- Sin persistencia — se regenera al reiniciar el servidor

## Interpretación de Resultados

### Severidades
- **Crítico** 🔴: Acción inmediata requerida (fraude potencial, pérdida significativa)
- **Alto** 🟠: Revisar dentro de 24 horas
- **Medio** 🟡: Incluir en revisión semanal
- **Bajo** 🔵: Oportunidad de mejora
- **Info** ⚪: Dato informativo para contexto

### Métricas de Impacto
- Los estimados de aumento de ventas son **aproximaciones** basadas en elasticidad histórica
- Los valores monetarios representan potencial, no garantía
- Se recomienda validar top 3 sugerencias antes de implementar masivamente

## Dependencias
- Prisma ORM para consultas a base de datos
- Datos de: `SaleOrder`, `SaleOrderLine`, `Product`, `InventoryBalance`, `InventoryMovement`, `Payment`, `Branch`, `User`
- Clasificación ABC-XYZ existente en `src/modules/analytics/`
