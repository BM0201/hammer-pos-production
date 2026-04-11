# Guía de Clasificación ABC-XYZ

## ¿Qué es la Clasificación ABC-XYZ?

### ABC (por Valor de Ventas)
Clasifica productos según su contribución al valor total de ventas:

| Clase | % Productos | % Valor Ventas | Descripción |
|-------|-------------|----------------|-------------|
| **A** | 10-20% | 70-80% | Alto valor, críticos para el negocio |
| **B** | 30% | 15-25% | Valor medio, importantes |
| **C** | 50-60% | 5-10% | Bajo valor individual, muchos artículos |

### XYZ (por Estabilidad de Demanda)
Clasifica productos según la variabilidad de su demanda diaria:

| Clase | Coef. Variación | Descripción |
|-------|-----------------|-------------|
| **X** | CV < 0.5 | Demanda estable, predecible |
| **Y** | 0.5 ≤ CV < 1.0 | Demanda variable, parcialmente predecible |
| **Z** | CV ≥ 1.0 | Demanda irregular, impredecible |

## Matriz de Estrategias (9 Categorías)

| | X (Estable) | Y (Variable) | Z (Irregular) |
|---|---|---|---|
| **A** | EDLP, stock alto, margen 15-20% | Promociones periódicas, margen 20-25% | Control estricto, margen 25-30% |
| **B** | Stock estable, margen 25-30% | Revisión quincenal, margen 30-35% | Pedidos bajo demanda, margen 35-40% |
| **C** | Stock mínimo, margen 35-40% | Evaluar eliminación, margen 40-45% | Liquidar si >90 días, margen 45-50% |

## Índice de Rotación (IR)

```
IR = Costo de Ventas del Mes / Inventario Promedio del Mes
```

- **IR > 8**: Alta rotación → Márgenes bajos, volumen
- **IR 4-8**: Media rotación → Márgenes estándar
- **IR < 4**: Baja rotación → Márgenes altos, descuentos progresivos

## Descuentos por Días en Stock

| Días en Stock | Ajuste al Margen |
|---------------|------------------|
| 0-30 días | Precio completo |
| 31-60 días | -10% al margen |
| 61-90 días | -20% al margen |
| 91+ días | -30% (liquidación) |

## Cómo Ejecutar la Clasificación

1. Navegar a **Master → Gobernanza → Analytics ABC-XYZ**
2. Click en **"Ejecutar Clasificación ABC-XYZ"**
3. El sistema procesará:
   - Clasificación ABC por valor de ventas
   - Clasificación XYZ por variabilidad de demanda (90 días)
   - Cálculo de índices de rotación
   - Actualización de días en stock
   - Cálculo de márgenes sugeridos

## Cómo Interpretar Resultados

### Productos Clase A
- **Acción**: Mantener stock seguro, monitorear diariamente
- **Margen**: 15-30% dependiendo de XYZ
- **Riesgo de stockout**: ALTO (impacto crítico en ventas)

### Productos Clase B
- **Acción**: Revisión semanal/quincenal
- **Margen**: 25-40%
- **Flexibilidad**: Media

### Productos Clase C
- **Acción**: Stock mínimo, evaluar eliminación si baja rotación
- **Margen**: 35-50%
- **Alertas**: Si >90 días en stock, candidato a liquidación

## Frecuencia de Actualización

| Tipo | Frecuencia Recomendada |
|------|------------------------|
| Clasificación ABC | Mensual |
| Clasificación XYZ | Mensual |
| Índice de rotación | Mensual |
| Días en stock | Semanal o diario |
| Márgenes sugeridos | Después de cada clasificación |

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/analytics/classify` | Ejecutar clasificación completa |
| GET | `/api/analytics/products` | Productos con analytics |
| GET | `/api/analytics/dashboard` | Datos para dashboard |
